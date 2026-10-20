import "./fixtures/catalog-environment.ts";
import { beforeAll, expect, test } from "bun:test";

import { UserRole } from "@repo/shared/discord";

import { INTEGRATION_DOMAINS } from "../../agent/lib/catalog/domains.ts";
import { qualifySkillReferences } from "../../agent/lib/catalog/skill-references.ts";
import skillDefinition from "../../agent/skills/integrations.ts";
import {
  ContextContainer,
  contextStorage,
  type AlsContext,
} from "../../node_modules/eve/dist/src/context/container.js";
import { buildResolveContext } from "../../node_modules/eve/dist/src/context/dynamic-resolve-context.js";
import { dispatchDynamicSkillEvent } from "../../node_modules/eve/dist/src/context/dynamic-skill-lifecycle.js";
import {
  preparePersistedStepDynamicToolMetadata,
  resolveStepDynamicTools,
} from "../../node_modules/eve/dist/src/context/dynamic-tool-lifecycle.js";
import {
  AuthKey,
  DynamicSkillManifestKey,
  InitiatorAuthKey,
  SandboxKey,
  SessionIdKey,
  StaticModelReferenceKey,
  StepDynamicToolMetadataKey,
} from "../../node_modules/eve/dist/src/context/keys.js";
import {
  deserializeContext,
  serializeContext,
} from "../../node_modules/eve/dist/src/context/serialize.js";
import { buildStepCatalog } from "../../node_modules/eve/dist/src/execution/catalog/step-catalog.js";
import { checkToolCallInput } from "../../node_modules/eve/dist/src/harness/tool-call-io.js";
import {
  callDurableDynamicCallback,
  clearDurableDynamicCallbacks,
  lookupDurableDynamicCallback,
} from "../../node_modules/eve/dist/src/tools/durable-callbacks.js";
import { principal, toolContext } from "./fixtures/catalog-context.ts";
import { compiledCatalog } from "./fixtures/compiled-catalog.ts";

const coordinates = { sequence: 1, stepIndex: 0, turnId: "turn-1" };
const stepEvent = {
  type: "step.started",
  data: { ...coordinates, modelId: "test-model" },
} as const;
const turnEvent = { type: "turn.started", data: { ...coordinates } } as const;
let compiled: Awaited<ReturnType<typeof compiledCatalog>>;
beforeAll(async () => {
  compiled = await compiledCatalog();
});

function context(role: UserRole = UserRole.Admin) {
  const ctx = new ContextContainer();
  ctx.set(SessionIdKey, crypto.randomUUID());
  ctx.set(AuthKey, principal(role));
  ctx.set(InitiatorAuthKey, principal(UserRole.Admin));
  ctx.set(StaticModelReferenceKey, { id: "test-model" });
  return ctx;
}

// Eve's ContextContainer accessor is wider than its AlsContext declaration
// under exactOptionalPropertyTypes. Delegate its methods without an assertion.
function nativeScope(ctx: ContextContainer): AlsContext {
  return {
    get: (key) => ctx.get(key),
    require: (key) => ctx.require(key),
    has: (key) => ctx.has(key),
    set: (key, value) => ctx.set(key, value),
    ensure: (key, create) => ctx.ensure(key, create),
    delete: (key) => ctx.delete(key),
    entries: () => ctx.entries(),
    setVirtualContext: (key, value) => ctx.setVirtualContext(key, value),
  };
}

function toolResolvers(ctx: ContextContainer) {
  const handler = compiled.events["step.started"];
  if (handler === undefined) throw new Error("Missing tool resolver");
  return [
    {
      slug: "integrations",
      logicalPath: "tools/integrations.ts",
      sourceId: "tools/integrations.ts",
      sourceKind: "module" as const,
      eventNames: ["step.started"],
      events: { "step.started": () => handler(stepEvent, buildResolveContext(ctx, [])) },
    },
  ];
}

async function resolveSkills(ctx: ContextContainer) {
  const handler = skillDefinition.events["turn.started"];
  if (handler === undefined) throw new Error("Missing skill resolver");
  await dispatchDynamicSkillEvent({
    ctx,
    event: turnEvent,
    messages: [],
    resolvers: [
      {
        slug: "integrations",
        logicalPath: "skills/integrations.ts",
        sourceId: "skills/integrations.ts",
        sourceKind: "module",
        eventNames: ["turn.started"],
        events: { "turn.started": () => handler(turnEvent, buildResolveContext(ctx, [])) },
      },
    ],
  });
}

async function resolveCatalog(ctx: ContextContainer) {
  await resolveStepDynamicTools({
    ctx: nativeScope(ctx),
    resolvers: toolResolvers(ctx),
    event: stepEvent,
    messages: [],
  });
  await resolveSkills(ctx);
  return buildStepCatalog({ agentTools: new Map(), ctx, endsTurn: true, session: {} });
}

test("native catalog retains all 670 provider operations and 106 procedures in stable namespaces", async () => {
  const ctx = context();
  const catalog = await resolveCatalog(ctx);
  expect(Object.keys(INTEGRATION_DOMAINS)).toHaveLength(12);
  expect(catalog.deferred.size).toBe(670);
  expect(catalog.skills.size).toBe(118); // 106 procedures plus 12 provider overviews.
  expect([...catalog.advertised.keys()].sort()).toEqual(["eve__search", "eve__skill", "eve__tool"]);
  expect(catalog.connections).toHaveLength(0);
  expect(ctx.has(SandboxKey)).toBe(false);
  for (const domain of Object.values(INTEGRATION_DOMAINS)) {
    for (const operation of Object.keys(domain.tools))
      expect(catalog.deferred.has(`${domain.name}__${operation}`)).toBe(true);
    for (const skill of domain.skills)
      expect(catalog.skills.has(`${domain.name}__${skill.name}`)).toBe(true);
  }
  for (const tool of catalog.deferred.values()) {
    expect(tool.name).toMatch(/^[a-z]+__[a-z0-9_]+$/u);
    expect(tool.name.length).toBeLessThanOrEqual(64);
    expect(tool.approval).toBeDefined();
  }
  const metadata = ctx.get(StepDynamicToolMetadataKey) ?? [];
  for (const entry of metadata) {
    expect(entry.callbacks).toMatchObject({
      execute: { closure: { domainName: expect.any(String), toolName: expect.any(String) } },
      inputSchema: { closure: { domainName: expect.any(String), toolName: expect.any(String) } },
      approvalRequest: {
        closure: { domainName: expect.any(String), toolName: expect.any(String) },
      },
      approvalResponse: {
        closure: { domainName: expect.any(String), toolName: expect.any(String) },
      },
    });
    for (const binding of Object.values(entry.callbacks ?? {}))
      expect(Object.keys(binding.closure).sort()).toEqual(["domainName", "toolName"]);
  }
});

test("native search returns only a requested namespace and exposes schemas progressively", async () => {
  const catalog = await resolveCatalog(context());
  const search = catalog.advertised.get("eve__search");
  if (search?.execute === undefined) throw new Error("Missing native search");
  const result: unknown = await search.execute(
    { query: "discord__get_server_info", limit: 1 },
    { toolCallId: "search", messages: [] },
  );
  expect(result).toMatchObject({
    results: [
      { tool: "discord__get_server_info", signature: expect.stringContaining("get_server_info") },
    ],
  });
  expect(JSON.stringify(result)).not.toContain("github__");
  expect(JSON.stringify(search.inputSchema)).not.toContain("get_server_info");
  const resolved = catalog.resolve({
    toolName: "eve__tool",
    input: { name: "discord__get_server_info", input: {} },
  });
  expect(resolved?.definition.name).toBe("discord__get_server_info");
  expect(
    catalog.resolve({ toolName: "eve__tool", input: { name: "discord__made_up", input: {} } }),
  ).toBeUndefined();
  const call = catalog.advertised.get("eve__tool");
  if (call === undefined) throw new Error("Missing native tool dispatcher");
  expect(
    (
      await checkToolCallInput(
        call,
        { name: "discord__get_server_info", input: { unknown: true } },
        "invalid",
      )
    ).kind,
  ).toBe("invalid");
});

test("native skill load and durable manifest replay allocate no sandbox", async () => {
  const original = context();
  await resolveSkills(original);
  const restored = await deserializeContext(
    structuredClone(serializeContext(nativeScope(original))),
  );
  const catalog = buildStepCatalog({
    agentTools: new Map(),
    ctx: restored,
    endsTurn: true,
    session: {},
  });
  for (const [name, skill] of catalog.skills) {
    expect(skill.path).toBeUndefined();
    const resolved = catalog.resolve({ toolName: "eve__skill", input: { name } });
    if (resolved?.definition.execute === undefined)
      throw new Error(`Skill ${name} is not loadable`);
    const markdown: unknown = await resolved.definition.execute(resolved.call.input, {
      toolCallId: "skill",
      messages: [],
    });
    expect(markdown).toBe(skill.markdown);
  }
  expect(restored.has(SandboxKey)).toBe(false);
  restored.set(AuthKey, principal(UserRole.Public));
  await resolveSkills(restored);
  expect(restored.get(DynamicSkillManifestKey)).toEqual({});
});

test("restarts restore live validators and execution guards from string captures", async () => {
  const original = context();
  await resolveCatalog(original);
  const sessionId = original.require(SessionIdKey);
  const restored = await deserializeContext(
    structuredClone(serializeContext(nativeScope(original))),
  );
  clearDurableDynamicCallbacks(sessionId);
  const scope = nativeScope(restored);
  await contextStorage.run(scope, () =>
    preparePersistedStepDynamicToolMetadata({
      ctx: scope,
      resolvers: toolResolvers(restored),
      event: stepEvent,
      messages: [],
    }),
  );
  const catalog = buildStepCatalog({
    agentTools: new Map(),
    ctx: restored,
    endsTurn: true,
    session: {},
  });
  const call = catalog.advertised.get("eve__tool");
  if (call === undefined) throw new Error("Missing replayed dispatcher");
  expect(
    (await checkToolCallInput(call, { name: "discord__get_server_info", input: {} }, "valid")).kind,
  ).toBe("valid");
  expect(
    (
      await checkToolCallInput(
        call,
        { name: "discord__get_server_info", input: { unknown: true } },
        "invalid",
      )
    ).kind,
  ).toBe("invalid");
  const metadata = restored
    .require(StepDynamicToolMetadataKey)
    .find(({ name }) => name === "discord__get_server_info");
  if (metadata?.callbacks === undefined) throw new Error("Missing replay metadata");
  const callback = lookupDurableDynamicCallback(
    { ...metadata, sessionId, scope: "step" },
    "execute",
  );
  if (callback === undefined) throw new Error("Missing rebound callback");
  expect(
    await callDurableDynamicCallback(
      callback,
      metadata.callbacks.execute.closure,
      {},
      toolContext(principal(UserRole.Public), undefined, metadata.name),
    ),
  ).toMatchObject({ ok: false, error: { tag: "Forbidden" } });
});

test("public callers discover zero provider tools even with a privileged initiator", async () => {
  const ctx = context(UserRole.Public);
  const catalog = await resolveCatalog(ctx);
  expect(catalog.entries.size).toBe(0);
  expect(catalog.skills.size).toBe(0);
  expect(
    catalog.resolve({ toolName: "eve__tool", input: { name: "discord__get_server_info" } }),
  ).toBeUndefined();
  expect(ctx.has(SandboxKey)).toBe(false);
});

test("skill references explicitly qualify known operations and skills", () => {
  expect(
    qualifySkillReferences(
      "Use `load_skill`, `read`, `manage`, and `url`. Keep `other__read`.",
      "demo",
      ["read"],
      ["manage"],
    ),
  ).toBe("Use `eve__skill`, `demo__read`, `demo__manage`, and `url`. Keep `other__read`.");
});

test("existing provider procedures qualify prose, call forms, and colliding names", async () => {
  const catalog = await resolveCatalog(context());
  const channels = catalog.skills.get("discord__channels")?.markdown;
  expect(channels).toContain("use discord__list_channels");
  expect(channels).toContain("Use discord__edit_channel");
  expect(channels).toContain("discord__get_channel returns");
  const events = catalog.skills.get("cms__events")?.markdown;
  expect(events).toContain("`cms__update_rsvp({ unsubscribed: true })`");
  expect(events).toContain("`cms__list_rsvps({ event_id: <id>, limit: 100 })`");
  expect(catalog.skills.get("github__projects")?.markdown).toContain("github__get_project");
  expect(
    qualifySkillReferences(
      "Read get_project. Keep https://example.com/get_project and notes/get_project.md; projects are useful.",
      "github",
      ["get_project"],
      ["projects"],
    ),
  ).toBe(
    "Read github__get_project. Keep https://example.com/get_project and notes/get_project.md; projects are useful.",
  );
});
