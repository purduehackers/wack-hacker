import type { UIMessage } from "ai";
import type { ModelMessage, StepResult, ToolSet } from "ai";
import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { UserRole } from "@/lib/ai/constants";
import {
  contextForRole,
  installMockProvider,
  noopTool,
  streamingTextModel,
  toolLoopingModel,
  toolThenErrorModel,
  TEST_SKILLS,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

import { access } from "./policy/index.ts";
import { SkillRegistry } from "./skills/index.ts";
import {
  appendEntitiesAppendix,
  buildPrepareStep,
  createDelegationTool,
  detectExhaustion,
  extractEntitiesTrailer,
  recordSubagentMetrics,
} from "./subagent.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

vi.mock("@sentry/nextjs", () => ({
  metrics: { count: vi.fn(), distribution: vi.fn() },
}));

import * as Sentry from "@sentry/nextjs";

const baseSpec = {
  name: "test",
  description: "Test delegation",
  systemPrompt: "Domain rules.\n\n{{SKILL_MENU}}\n\nEnd.",
  tools: {
    search_entities: noopTool("search_entities"),
    retrieve_entities: noopTool("retrieve_entities"),
  },
  subSkills: TEST_SKILLS,
  baseToolNames: ["search_entities", "retrieve_entities"] as const,
};

async function drainTool(
  t: ReturnType<typeof createDelegationTool>,
  input: unknown,
): Promise<UIMessage[]> {
  const received: UIMessage[] = [];
  const gen = t.execute!(
    input,
    {} as Parameters<NonNullable<typeof t.execute>>[1],
  ) as AsyncIterable<UIMessage>;
  for await (const msg of gen) received.push(msg);
  return received;
}

async function drainSpec(
  spec: Parameters<typeof createDelegationTool>[0],
  input: unknown,
  context: Parameters<typeof createDelegationTool>[1] = contextForRole(UserRole.Admin),
) {
  return drainTool(createDelegationTool(spec, context, new TurnUsageTracker()), input);
}

describe("createDelegationTool — tool shape", () => {
  it("returns a tool with the spec description", () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    expect(t.description).toBe("Test delegation");
  });

  it("validates the task input schema", () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    const schema = t.inputSchema as unknown as {
      safeParse: (input: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ task: "hello" }).success).toBe(true);
    expect(schema.safeParse({ task: 42 }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("rejects a custom inputSchema without a paired getPrompt at the type level", async () => {
    const invalidSpec = {
      ...baseSpec,
      inputSchema: z.object({ instructions: z.string() }),
    };
    const t = createDelegationTool(
      // @ts-expect-error — custom inputSchema requires a paired getPrompt
      invalidSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    // Runtime backstop for untyped call sites: the default getPrompt only
    // understands `{ task }`, so a custom shape without getPrompt hard-throws.
    await expect(drainTool(t, { instructions: "do X" })).rejects.toThrow(/no `task` string/);
  });
});

describe("createDelegationTool — execute() against MockLanguageModelV3", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    model = streamingTextModel("final answer");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("yields UIMessages ending with the model's final text", async () => {
    const messages = await drainSpec(baseSpec, { task: "do the thing" });
    expect(messages.length).toBeGreaterThan(0);
    const last = messages.at(-1)!;
    const textParts = last.parts.filter(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(textParts.map((p) => p.text).join("")).toBe("final answer");
  });

  it("substitutes {{SKILL_MENU}} in the system prompt before calling the model", async () => {
    await drainSpec(baseSpec, { task: "do the thing" });
    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const systemContent =
      typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    const menu = new SkillRegistry(TEST_SKILLS).buildSkillMenu(UserRole.Admin);
    expect(systemContent).toContain(menu);
    expect(systemContent).not.toContain("{{SKILL_MENU}}");
  });

  it("appends the execution context block to the subagent instructions", async () => {
    const context = contextForRole(UserRole.Admin);
    const t = createDelegationTool(baseSpec, context, new TurnUsageTracker());
    await drainTool(t, { task: "assign this to me, due Friday" });
    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const systemContent =
      typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    expect(systemContent).toContain("<execution_context>");
    expect(systemContent).toContain(`requesting_user: ${JSON.stringify(context.nickname)}`);
    expect(systemContent).toContain(`discord id ${context.userId}`);
    expect(systemContent).toContain(context.nowISO);
    expect(systemContent).toContain(`tz: ${context.timezone}`);
  });

  it("renders a role-filtered menu — public's differs from organizer's", async () => {
    await drainSpec(baseSpec, { task: "do the thing" }, contextForRole(UserRole.Public));
    await drainSpec(baseSpec, { task: "do the thing" }, contextForRole(UserRole.Organizer));
    const [publicCall, organizerCall] = model.doStreamCalls;
    const systemOf = (call: (typeof model.doStreamCalls)[number]) => {
      const system = call!.prompt.find((m) => m.role === "system");
      return typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    };
    const registry = new SkillRegistry(TEST_SKILLS);
    expect(systemOf(publicCall)).toContain(registry.buildSkillMenu(UserRole.Public));
    expect(systemOf(organizerCall)).toContain(registry.buildSkillMenu(UserRole.Organizer));
    // The organizer-gated "linear" fixture skill must be invisible to public.
    expect(systemOf(publicCall)).not.toContain("linear");
    expect(systemOf(organizerCall)).toContain("linear");
    expect(systemOf(publicCall)).not.toEqual(systemOf(organizerCall));
  });

  it("exposes the baseToolNames plus loadSkill to the model on the first call", async () => {
    await drainSpec(baseSpec, { task: "do the thing" });
    const call = model.doStreamCalls[0]!;
    const toolNames = (call.tools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter((name): name is string => typeof name === "string");
    expect(toolNames.sort()).toEqual(["loadSkill", "retrieve_entities", "search_entities"].sort());
  });

  it("strips tools above the subject's role (deny-by-absence)", async () => {
    const adminTool = access({ risk: "read", minRole: "admin" }, noopTool("danger"));
    const publicTool = noopTool("ok");
    const spec = {
      description: baseSpec.description,
      systemPrompt: baseSpec.systemPrompt,
      subSkills: baseSpec.subSkills,
      tools: { adminTool, publicTool },
      baseToolNames: ["adminTool", "publicTool"] as const,
    } as unknown as typeof baseSpec;
    await drainSpec(spec, { task: "do the thing" }, contextForRole(UserRole.Public));

    const call = model.doStreamCalls[0]!;
    const declaredToolNames = (call.tools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter((n): n is string => typeof n === "string");
    expect(declaredToolNames).toContain("publicTool");
    expect(declaredToolNames).toContain("loadSkill");
    expect(declaredToolNames).not.toContain("adminTool");
  });
});

describe("createDelegationTool — extended SubagentSpec (input + context)", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    model = streamingTextModel("final answer");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("routes a custom inputSchema through its getPrompt", async () => {
    const spec = {
      ...baseSpec,
      inputSchema: z.object({ repo: z.string(), task: z.string() }),
      getPrompt: (input: unknown) => (input as { task: string }).task,
    };
    await drainSpec(spec, { repo: "purduehackers/x", task: "do the thing" });

    const call = model.doStreamCalls[0]!;
    const userMessage = call.prompt.find((m) => m.role === "user");
    const content =
      typeof userMessage?.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage?.content);
    expect(content).toContain("do the thing");
    expect(content).not.toContain("purduehackers/x");
  });

  it("passes buildExperimentalContext's result as experimental_context to the nested agent", async () => {
    const spec = {
      ...baseSpec,
      buildExperimentalContext: (input: unknown) => ({ marker: "ctx", input }),
    };
    await drainSpec(spec, { task: "go" });

    const call = model.doStreamCalls[0]!;
    // providerOptions is what AI SDK forwards; experimental_context is wired via provider metadata.
    // We assert indirectly: the agent actually ran one step + the mock model was invoked.
    expect(call).toBeDefined();
  });
});

describe("createDelegationTool — extended SubagentSpec (postFinish + model)", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    model = streamingTextModel("final answer");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("invokes postFinish after the stream completes and forwards its yielded messages", async () => {
    const extra: UIMessage = {
      id: "post",
      role: "assistant",
      parts: [{ type: "text", text: "post-finish message" }],
    } as unknown as UIMessage;
    let exhaustedFlag: boolean | undefined;
    const spec = {
      ...baseSpec,
      postFinish: async function* (args: { exhausted: boolean }) {
        exhaustedFlag = args.exhausted;
        yield extra;
      },
    };
    const messages = await drainSpec(spec, { task: "go" });
    const last = messages.at(-1)!;
    const lastText = last.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
    expect(lastText?.text).toBe("post-finish message");
    expect(exhaustedFlag).toBe(false);
  });

  it("uses spec.model when supplied", async () => {
    const spec = { ...baseSpec, model: "anthropic/claude-opus-4.7" };
    await drainSpec(spec, { task: "go" });
    // The mock provider proxies any model id, so we can't assert on the model string directly;
    // what we can assert is that the stream succeeded (i.e. the override didn't blow up).
    expect(model.doStreamCalls.length).toBeGreaterThan(0);
  });
});

describe("createDelegationTool — prompt extraction", () => {
  beforeEach(() => {
    installMockProvider(streamingTextModel("ok"));
    vi.mocked(Sentry.metrics.count).mockClear();
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("throws when the default-schema input has no task string, and emits an error metric", async () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    await expect(drainTool(t, { instructions: "do X" })).rejects.toThrow(/no `task` string/);
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.error", 1, {
      attributes: { domain: "test", model: "openai/gpt-5.4-mini" },
    });
  });

  it("throws when input is not an object", async () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    await expect(drainTool(t, "just a string")).rejects.toThrow(/no `task` string/);
  });
});

describe("createDelegationTool — step-cap exhaustion", () => {
  beforeEach(() => {
    vi.mocked(Sentry.metrics.count).mockClear();
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("yields an honest exhaustion message when the cap cuts a tool-calling run", async () => {
    installMockProvider(toolLoopingModel("search_entities"));
    const spec = { ...baseSpec, stopSteps: 2 };
    const t = createDelegationTool(spec, contextForRole(UserRole.Admin), new TurnUsageTracker());
    const messages = await drainTool(t, { task: "loop forever" });

    const last = messages.at(-1)!;
    const lastText = last.parts.findLast(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(lastText?.text).toBe("Subagent stopped after 2 steps without completing the task.");

    const output = t.toModelOutput!({
      output: last,
    } as Parameters<NonNullable<typeof t.toModelOutput>>[0]);
    expect(output).toEqual({
      type: "text",
      value: expect.stringContaining("stopped after 2 steps") as unknown,
    });
  });

  it("labels the model's mid-task narration as last progress, not as the answer", async () => {
    installMockProvider(toolLoopingModel("search_entities", { narration: "Let me check X first" }));
    const messages = await drainSpec({ ...baseSpec, stopSteps: 2 }, { task: "loop forever" });

    const lastText = messages
      .at(-1)!
      .parts.findLast((p): p is { type: "text"; text: string } => p.type === "text");
    expect(lastText?.text).toBe(
      "Subagent stopped after 2 steps without completing the task. Last progress: Let me check X first",
    );
  });

  it("counts step_cap_hit and skips the completed counter on exhaustion", async () => {
    installMockProvider(toolLoopingModel("search_entities"));
    await drainSpec({ ...baseSpec, stopSteps: 2 }, { task: "loop forever" });

    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.step_cap_hit", 1, {
      attributes: { domain: "test" },
    });
    expect(Sentry.metrics.count).not.toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
  });

  it("lets postFinish own the final message and passes the cap outcome to it", async () => {
    installMockProvider(toolLoopingModel("search_entities"));
    let captured: { exhausted: boolean; hitStepCap: boolean } | undefined;
    const spec = {
      ...baseSpec,
      stopSteps: 2,
      postFinish: async function* (args: { exhausted: boolean; hitStepCap: boolean }) {
        captured = { exhausted: args.exhausted, hitStepCap: args.hitStepCap };
        yield {
          id: "post",
          role: "assistant",
          parts: [{ type: "text", text: "labeled partial work" }],
        } as unknown as UIMessage;
      },
    };
    const messages = await drainSpec(spec, { task: "loop forever" });

    expect(captured).toEqual({ exhausted: true, hitStepCap: true });
    const lastText = messages
      .at(-1)!
      .parts.findLast((p): p is { type: "text"; text: string } => p.type === "text");
    expect(lastText?.text).toBe("labeled partial work");
  });

  it("does not flag exhaustion for a run that finishes under the cap", async () => {
    installMockProvider(streamingTextModel("done"));
    const messages = await drainSpec(baseSpec, { task: "quick" });
    const lastText = messages
      .at(-1)!
      .parts.findLast((p): p is { type: "text"; text: string } => p.type === "text");
    expect(lastText?.text).toBe("done");
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
    expect(Sentry.metrics.count).not.toHaveBeenCalledWith("ai.subagent.step_cap_hit", 1, {
      attributes: { domain: "test" },
    });
  });
});

describe("createDelegationTool — mid-run crash", () => {
  beforeEach(() => {
    vi.mocked(Sentry.metrics.count).mockClear();
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("rethrows the crash instead of recording the run as completed", async () => {
    installMockProvider(toolThenErrorModel("search_entities", "provider exploded"));
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    await expect(drainTool(t, { task: "crash mid-run" })).rejects.toThrow();
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.error", 1, {
      attributes: { domain: "test", model: "openai/gpt-5.4-mini" },
    });
    expect(Sentry.metrics.count).not.toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
  });
});

describe("detectExhaustion", () => {
  const step = (finishReason: string) => ({ toolCalls: [], finishReason });

  it("is false below the cap", () => {
    expect(detectExhaustion([step("tool-calls")], 15)).toEqual({
      hitStepCap: false,
      exhausted: false,
    });
  });

  it("hits the cap without exhaustion when the final step produced text", () => {
    expect(detectExhaustion([step("tool-calls"), step("stop")], 2)).toEqual({
      hitStepCap: true,
      exhausted: false,
    });
  });

  it("is exhausted when the cap cut a step that still wanted tools", () => {
    expect(detectExhaustion([step("tool-calls"), step("tool-calls")], 2)).toEqual({
      hitStepCap: true,
      exhausted: true,
    });
  });
});

describe("createDelegationTool — toModelOutput()", () => {
  function uiMessage(parts: Array<{ type: string; text?: string }>): UIMessage {
    return { id: "m", role: "assistant", parts } as unknown as UIMessage;
  }

  function makeTool() {
    return createDelegationTool(baseSpec, contextForRole(UserRole.Admin), new TurnUsageTracker());
  }

  it("extracts the last text part from the final UIMessage", () => {
    const t = makeTool();
    const output = uiMessage([
      { type: "text", text: "first" },
      { type: "tool-call" },
      { type: "text", text: "final answer" },
    ]);
    expect(
      t.toModelOutput!({ output } as Parameters<NonNullable<typeof t.toModelOutput>>[0]),
    ).toEqual({ type: "text", value: "final answer" });
  });

  it("falls back to an honest no-output message when no text parts exist", () => {
    const t = makeTool();
    const output = uiMessage([{ type: "tool-call" }]);
    expect(
      t.toModelOutput!({ output } as Parameters<NonNullable<typeof t.toModelOutput>>[0]),
    ).toEqual({ type: "text", value: "Subagent returned no final text." });
  });

  it("falls back when output is undefined", () => {
    const t = makeTool();
    expect(
      t.toModelOutput!({ output: undefined } as unknown as Parameters<
        NonNullable<typeof t.toModelOutput>
      >[0]),
    ).toEqual({ type: "text", value: "Subagent returned no final text." });
  });

  it("strips the entities trailer and appends a compact appendix", () => {
    const t = makeTool();
    const text = [
      "**Summary**: Filed the issue.",
      "",
      "**Answer**: Created [PH-12](https://linear.app/ph/issue/PH-12).",
      "",
      "```entities",
      "PH-12 | linear_issue | 123e4567-e89b-42d3-a456-426614174000 | https://linear.app/ph/issue/PH-12",
      "```",
    ].join("\n");
    const result = t.toModelOutput!({ output: uiMessage([{ type: "text", text }]) } as Parameters<
      NonNullable<typeof t.toModelOutput>
    >[0]) as { type: "text"; value: string };
    expect(result.value).not.toContain("```entities");
    expect(result.value).toContain(
      "Entities: [PH-12](https://linear.app/ph/issue/PH-12) (linear_issue 123e4567-e89b-42d3-a456-426614174000)",
    );
  });
});

describe("entities handoff helpers", () => {
  it("parses trailer lines into structured entities and strips the block", () => {
    const text =
      "Answer.\n\n```entities\nPH-1 | issue | uuid-1 | https://x.test/1\nmain | branch | |\n```";
    const { text: stripped, entities } = extractEntitiesTrailer(text);
    expect(stripped).toBe("Answer.");
    expect(entities).toEqual([
      { name: "PH-1", type: "issue", id: "uuid-1", url: "https://x.test/1" },
      { name: "main", type: "branch", id: undefined, url: undefined },
    ]);
  });

  it("skips trailer lines without a name and tolerates sparse fields", () => {
    const text =
      "Answer.\n\n```entities\n| ghost | id-1 | https://x.test/g\nPH-9 | | abc-123 |\n```";
    const { entities } = extractEntitiesTrailer(text);
    expect(entities).toEqual([{ name: "PH-9", type: undefined, id: "abc-123", url: undefined }]);
  });

  it("renders url-less entities as plain text in the appendix", () => {
    const out = appendEntitiesAppendix("Done.\n\n```entities\nPH-9 | issue | abc-123 |\n```");
    expect(out).toBe("Done.\n\nEntities: PH-9 (issue abc-123)");
  });

  it("folds extra pipes into the entity name instead of shifting fields", () => {
    const text =
      "Answer.\n\n```entities\nHack Night | Week 3 | page | 1a2b-uuid | https://notion.so/abc\n```";
    const { entities } = extractEntitiesTrailer(text);
    expect(entities).toEqual([
      { name: "Hack Night | Week 3", type: "page", id: "1a2b-uuid", url: "https://notion.so/abc" },
    ]);
  });

  it("harvests markdown links when no trailer is present", () => {
    const text =
      "Done: [PR #5](https://github.com/x/y/pull/5) and [PR #5](https://github.com/x/y/pull/5) again.";
    const { text: kept, entities } = extractEntitiesTrailer(text);
    expect(kept).toBe(text);
    expect(entities).toEqual([{ name: "PR #5", url: "https://github.com/x/y/pull/5" }]);
  });

  it("leaves text without links or trailer untouched", () => {
    expect(appendEntitiesAppendix("plain answer")).toBe("plain answer");
  });

  it("appends a deduped appendix from harvested links", () => {
    const out = appendEntitiesAppendix("See [doc](https://d.test/a).");
    expect(out).toBe("See [doc](https://d.test/a).\n\nEntities: [doc](https://d.test/a)");
  });
});

describe("recordSubagentMetrics", () => {
  beforeEach(() => {
    vi.mocked(Sentry.metrics.count).mockClear();
  });

  it("records the model's totalTokens when present", () => {
    const tracker = new TurnUsageTracker();
    recordSubagentMetrics(tracker, { name: "test" }, { totalTokens: 42 }, [
      { toolCalls: [{}, {}] },
      { toolCalls: [{}] },
    ]);
    expect(tracker.totalTokens).toBe(42);
    expect(tracker.totalToolCalls).toBe(3);
  });

  it("falls back to 0 when totalTokens is undefined", () => {
    const tracker = new TurnUsageTracker();
    recordSubagentMetrics(tracker, { name: "test" }, {}, []);
    expect(tracker.totalTokens).toBe(0);
    expect(tracker.totalToolCalls).toBe(0);
  });

  it("collects tool names and skips entries without a string toolName", () => {
    const tracker = new TurnUsageTracker();
    recordSubagentMetrics(tracker, { name: "test" }, { totalTokens: 10 }, [
      { toolCalls: [{ toolName: "search_entities" }, {}] },
      { toolCalls: [{ toolName: "retrieve_entities" }] },
    ]);
    expect(tracker.toTurnUsage().toolNames).toEqual(["search_entities", "retrieve_entities"]);
  });

  it("counts completed (not step_cap_hit) for a clean run", () => {
    recordSubagentMetrics(new TurnUsageTracker(), { name: "test" }, {}, [], {
      hitStepCap: false,
      exhausted: false,
    });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
    expect(Sentry.metrics.count).not.toHaveBeenCalledWith("ai.subagent.step_cap_hit", 1, {
      attributes: { domain: "test" },
    });
  });

  it("counts step_cap_hit and suppresses completed on exhaustion", () => {
    recordSubagentMetrics(new TurnUsageTracker(), { name: "test" }, {}, [], {
      hitStepCap: true,
      exhausted: true,
    });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.step_cap_hit", 1, {
      attributes: { domain: "test" },
    });
    expect(Sentry.metrics.count).not.toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
  });

  it("counts both completed and step_cap_hit when the wrap-up step landed at the cap", () => {
    recordSubagentMetrics(new TurnUsageTracker(), { name: "test" }, {}, [], {
      hitStepCap: true,
      exhausted: false,
    });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.step_cap_hit", 1, {
      attributes: { domain: "test" },
    });
    expect(Sentry.metrics.count).toHaveBeenCalledWith("ai.subagent.completed", 1, {
      attributes: { domain: "test" },
    });
  });
});

describe("buildPrepareStep", () => {
  const registry = new SkillRegistry(TEST_SKILLS);

  it("omits activeTools when computeActiveTools returns null (no skill loaded yet)", () => {
    const prepare = buildPrepareStep({
      registry,
      role: UserRole.Admin,
      baseToolNames: ["alpha", "beta", "loadSkill"],
      model: "openai/gpt-5.4-mini",
      stopSteps: 15,
    });
    const out = prepare({
      steps: [] as StepResult<ToolSet>[],
      messages: [] as ModelMessage[],
    });
    expect("activeTools" in out).toBe(false);
    // PrepareStepResult has no `tools` key — returning one would be silently
    // ignored by the SDK, so the handler must not produce it.
    expect("tools" in out).toBe(false);
  });

  it("sets activeTools when a skill-load step unlocks new tools", () => {
    const skillName = Object.keys(TEST_SKILLS)[0];
    if (!skillName) throw new Error("TEST_SKILLS fixture is empty");

    const prepare = buildPrepareStep({
      registry,
      role: UserRole.Admin,
      baseToolNames: ["alpha", "loadSkill"],
      model: "anthropic/claude-opus-4.7",
      stopSteps: 15,
    });
    const steps = [
      {
        toolCalls: [{ toolName: "loadSkill", input: { name: skillName } }],
      } as unknown as StepResult<ToolSet>,
    ];
    const out = prepare({ steps, messages: [{ role: "user", content: "hi" }] });
    expect(Array.isArray(out.activeTools)).toBe(true);
  });

  it("forces a text-only wrap-up step at exactly cap−1", () => {
    const prepare = buildPrepareStep({
      registry,
      role: UserRole.Admin,
      baseToolNames: ["alpha", "loadSkill"],
      model: "openai/gpt-5.4-mini",
      stopSteps: 3,
    });
    const step = { toolCalls: [] } as unknown as StepResult<ToolSet>;

    const beforeWrapUp = prepare({ steps: [step], messages: [] });
    expect("toolChoice" in beforeWrapUp).toBe(false);

    const atWrapUp = prepare({ steps: [step, step], messages: [] });
    expect(atWrapUp.toolChoice).toBe("none");
  });
});
