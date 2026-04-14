import type { UIMessage } from "ai";
import type { MockLanguageModelV3 } from "ai/test";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UserRole } from "@/lib/ai/constants";
import {
  installMockProvider,
  noopTool,
  streamingTextModel,
  TEST_SKILLS,
  uninstallMockProvider,
} from "@/lib/test/fixtures";

import { admin, SkillRegistry } from "./skills/index.ts";
import { createDelegationTool } from "./subagent.ts";

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
    const t = createDelegationTool(baseSpec, UserRole.Admin);
    expect(t.description).toBe("Test delegation");
  });

  it("validates the task input schema", () => {
    const t = createDelegationTool(baseSpec, UserRole.Admin);
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
    const t = createDelegationTool(spec, role);
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

describe("createDelegationTool — toModelOutput()", () => {
  function uiMessage(parts: Array<{ type: string; text?: string }>): UIMessage {
    return { id: "m", role: "assistant", parts } as unknown as UIMessage;
  }

  it("extracts the last text part from the final UIMessage", () => {
    const t = createDelegationTool(baseSpec, UserRole.Admin);
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
    const t = createDelegationTool(baseSpec, UserRole.Admin);
    const output = uiMessage([{ type: "tool-call" }]);
    expect(
      t.toModelOutput!({ output } as Parameters<NonNullable<typeof t.toModelOutput>>[0]),
    ).toEqual({ type: "text", value: "Task completed." });
  });

  it("falls back when output is undefined", () => {
    const t = createDelegationTool(baseSpec, UserRole.Admin);
    expect(
      t.toModelOutput!({ output: undefined } as unknown as Parameters<
        NonNullable<typeof t.toModelOutput>
      >[0]),
    ).toEqual({ type: "text", value: "Task completed." });
  });
});
