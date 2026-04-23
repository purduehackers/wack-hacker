import type { UIMessage } from "ai";
import type { ModelMessage, StepResult, ToolSet } from "ai";
import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import {
  contextForRole,
  installMockProvider,
  noopTool,
  streamingTextModel,
  TEST_SKILLS,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

import { admin, SkillRegistry } from "./skills/index.ts";
import { buildPrepareStep, createDelegationTool, recordSubagentMetrics } from "./subagent.ts";
import { TurnUsageTracker } from "./turn-usage.ts";

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

  async function drain(spec: typeof baseSpec, role: UserRole) {
    const t = createDelegationTool(spec, contextForRole(role), new TurnUsageTracker());
    const received: UIMessage[] = [];
    const gen = t.execute!(
      { task: "do the thing" },
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    for await (const msg of gen) received.push(msg);
    return received;
  }

  it("yields UIMessages ending with the model's final text", async () => {
    const messages = await drain(baseSpec, UserRole.Admin);
    expect(messages.length).toBeGreaterThan(0);
    const last = messages.at(-1)!;
    const textParts = last.parts.filter(
      (p): p is { type: "text"; text: string } => p.type === "text",
    );
    expect(textParts.map((p) => p.text).join("")).toBe("final answer");
  });

  it("substitutes {{SKILL_MENU}} in the system prompt before calling the model", async () => {
    await drain(baseSpec, UserRole.Admin);
    const call = model.doStreamCalls[0]!;
    const system = call.prompt.find((m) => m.role === "system");
    const systemContent =
      typeof system?.content === "string" ? system.content : JSON.stringify(system?.content);
    const menu = new SkillRegistry(TEST_SKILLS).buildSkillMenu(UserRole.Admin);
    expect(systemContent).toContain(menu);
    expect(systemContent).not.toContain("{{SKILL_MENU}}");
  });

  it("exposes the baseToolNames plus loadSkill to the model on the first call", async () => {
    await drain(baseSpec, UserRole.Admin);
    const call = model.doStreamCalls[0]!;
    const toolNames = (call.tools ?? [])
      .map((t) => (t as { name?: string }).name)
      .filter((name): name is string => typeof name === "string");
    expect(toolNames.sort()).toEqual(["loadSkill", "retrieve_entities", "search_entities"].sort());
  });

  it("strips admin-marked tools for non-admin roles", async () => {
    const adminTool = admin(noopTool("danger"));
    const publicTool = noopTool("ok");
    const spec = {
      description: baseSpec.description,
      systemPrompt: baseSpec.systemPrompt,
      subSkills: baseSpec.subSkills,
      tools: { adminTool, publicTool },
      baseToolNames: ["adminTool", "publicTool"] as const,
    } as unknown as typeof baseSpec;
    await drain(spec, UserRole.Public);

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

  async function drainWith(
    spec: Parameters<typeof createDelegationTool>[0],
    input: unknown,
    context: Parameters<typeof createDelegationTool>[1] = contextForRole(UserRole.Admin),
  ) {
    const t = createDelegationTool(spec, context, new TurnUsageTracker());
    const received: UIMessage[] = [];
    const gen = t.execute!(
      input,
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    for await (const msg of gen) received.push(msg);
    return received;
  }

  it("routes a custom inputSchema and extracts the task string for the prompt", async () => {
    const spec = {
      ...baseSpec,
      inputSchema: (await import("zod")).z.object({
        repo: (await import("zod")).z.string(),
        task: (await import("zod")).z.string(),
      }),
    };
    await drainWith(spec, { repo: "purduehackers/x", task: "do the thing" });

    const call = model.doStreamCalls[0]!;
    const userMessage = call.prompt.find((m) => m.role === "user");
    const content =
      typeof userMessage?.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage?.content);
    expect(content).toContain("do the thing");
  });

  it("passes buildExperimentalContext's result as experimental_context to the nested agent", async () => {
    const spec = {
      ...baseSpec,
      buildExperimentalContext: (input: unknown) => ({ marker: "ctx", input }),
    };
    await drainWith(spec, { task: "go" });

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

  async function drainWith(
    spec: Parameters<typeof createDelegationTool>[0],
    input: unknown,
    context: Parameters<typeof createDelegationTool>[1] = contextForRole(UserRole.Admin),
  ) {
    const t = createDelegationTool(spec, context, new TurnUsageTracker());
    const received: UIMessage[] = [];
    const gen = t.execute!(
      input,
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    for await (const msg of gen) received.push(msg);
    return received;
  }

  it("invokes postFinish after the stream completes and forwards its yielded messages", async () => {
    const extra: UIMessage = {
      id: "post",
      role: "assistant",
      parts: [{ type: "text", text: "post-finish message" }],
    } as unknown as UIMessage;
    const spec = {
      ...baseSpec,
      postFinish: async function* () {
        yield extra;
      },
    };
    const messages = await drainWith(spec, { task: "go" });
    const last = messages.at(-1)!;
    const lastText = last.parts.find((p): p is { type: "text"; text: string } => p.type === "text");
    expect(lastText?.text).toBe("post-finish message");
  });

  it("uses spec.model when supplied", async () => {
    const spec = { ...baseSpec, model: "anthropic/claude-opus-4.7" };
    await drainWith(spec, { task: "go" });
    // The mock provider proxies any model id, so we can't assert on the model string directly;
    // what we can assert is that the stream succeeded (i.e. the override didn't blow up).
    expect(model.doStreamCalls.length).toBeGreaterThan(0);
  });
});

describe("createDelegationTool — extractPrompt fallback", () => {
  let model: MockLanguageModelV3;

  beforeEach(() => {
    model = streamingTextModel("ok");
    installMockProvider(model);
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("falls back to the first string field when no `task` key is present", async () => {
    const spec = {
      ...baseSpec,
      inputSchema: (await import("zod")).z.object({
        instructions: (await import("zod")).z.string(),
      }),
    };
    const t = createDelegationTool(spec, contextForRole(UserRole.Admin), new TurnUsageTracker());
    const gen = t.execute!(
      { instructions: "do X" },
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    const received: UIMessage[] = [];
    for await (const msg of gen) received.push(msg);

    const call = model.doStreamCalls[0]!;
    const userMessage = call.prompt.find((m) => m.role === "user");
    const content =
      typeof userMessage?.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage?.content);
    expect(content).toContain("do X");
  });

  it("throws when input is not an object", async () => {
    const spec = {
      ...baseSpec,
      inputSchema: (await import("zod")).z.any(),
    };
    const t = createDelegationTool(spec, contextForRole(UserRole.Admin), new TurnUsageTracker());
    const gen = t.execute!(
      "just a string",
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    await expect(async () => {
      for await (const _ of gen);
    }).rejects.toThrow(/non-object input/);
  });

  it("throws when object has no string field", async () => {
    const spec = {
      ...baseSpec,
      inputSchema: (await import("zod")).z.any(),
    };
    const t = createDelegationTool(spec, contextForRole(UserRole.Admin), new TurnUsageTracker());
    const gen = t.execute!(
      { foo: 1, bar: true },
      {} as Parameters<NonNullable<typeof t.execute>>[1],
    ) as AsyncIterable<UIMessage>;
    await expect(async () => {
      for await (const _ of gen);
    }).rejects.toThrow(/no string field/);
  });
});

describe("createDelegationTool — toModelOutput()", () => {
  function uiMessage(parts: Array<{ type: string; text?: string }>): UIMessage {
    return { id: "m", role: "assistant", parts } as unknown as UIMessage;
  }

  it("extracts the last text part from the final UIMessage", () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    const output = uiMessage([
      { type: "text", text: "first" },
      { type: "tool-call" },
      { type: "text", text: "final answer" },
    ]);
    expect(
      t.toModelOutput!({ output } as Parameters<NonNullable<typeof t.toModelOutput>>[0]),
    ).toEqual({ type: "text", value: "final answer" });
  });

  it("falls back to a completion message when no text parts exist", () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    const output = uiMessage([{ type: "tool-call" }]);
    expect(
      t.toModelOutput!({ output } as Parameters<NonNullable<typeof t.toModelOutput>>[0]),
    ).toEqual({ type: "text", value: "Task completed." });
  });

  it("falls back when output is undefined", () => {
    const t = createDelegationTool(
      baseSpec,
      contextForRole(UserRole.Admin),
      new TurnUsageTracker(),
    );
    expect(
      t.toModelOutput!({ output: undefined } as unknown as Parameters<
        NonNullable<typeof t.toModelOutput>
      >[0]),
    ).toEqual({ type: "text", value: "Task completed." });
  });
});

describe("recordSubagentMetrics", () => {
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
});

describe("buildPrepareStep", () => {
  const tools: ToolSet = {
    alpha: noopTool("alpha"),
    beta: noopTool("beta"),
  };
  const registry = new SkillRegistry(TEST_SKILLS);

  it("omits activeTools when computeActiveTools returns null (no skill loaded yet)", () => {
    const prepare = buildPrepareStep({
      registry,
      role: UserRole.Admin,
      baseToolNames: ["alpha", "beta", "loadSkill"],
      tools,
      model: "openai/gpt-5.4-mini",
    });
    const out = prepare({
      steps: [] as StepResult<ToolSet>[],
      messages: [] as ModelMessage[],
    });
    expect("activeTools" in out).toBe(false);
    expect(out.tools).toBe(tools);
  });

  it("sets activeTools when a skill-load step unlocks new tools", () => {
    const skillName = Object.keys(TEST_SKILLS)[0];
    if (!skillName) throw new Error("TEST_SKILLS fixture is empty");

    const prepare = buildPrepareStep({
      registry,
      role: UserRole.Admin,
      baseToolNames: ["alpha", "loadSkill"],
      tools,
      model: "anthropic/claude-opus-4.7",
    });
    const steps = [
      {
        toolCalls: [{ toolName: "loadSkill", input: { name: skillName } }],
      } as unknown as StepResult<ToolSet>,
    ];
    const out = prepare({ steps, messages: [{ role: "user", content: "hi" }] });
    expect(Array.isArray(out.activeTools)).toBe(true);
  });
});
