import { tool } from "ai";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import type { TurnUsage } from "./types.ts";

import { messagePacket } from "../test/fixtures/index.ts";
import { AgentContext } from "./context.ts";

const rawJsonSchemaTool = {
  description: "Raw JSON-schema tool.",
  inputSchema: { type: "object", properties: { kind: { type: "string" } } },
};

const toolWithoutSchema = {
  description: "Opaque provider tool.",
  inputSchema: undefined,
};

// A fake Zod-looking schema that toJSONSchema will reject at runtime.
const malformedZodLike = {
  description: "Broken zod tool.",
  inputSchema: { _zod: { notAValidSchema: true } },
};

vi.mock("./orchestrator", () => ({
  getOrchestratorTools: () => ({
    currentTime: tool({
      description: "Get the current time.",
      inputSchema: z.object({
        timezone: z.string().optional().describe("IANA timezone."),
      }),
      execute: async () => "now",
    }),
    documentation: tool({
      description: "Look up documentation.",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => "",
    }),
    scheduleTask: tool({
      description: "Schedule a task.",
      inputSchema: z.object({ when: z.string() }),
      execute: async () => "",
    }),
    rawJsonSchemaTool,
    toolWithoutSchema,
    malformedZodLike,
  }),
}));

// Import after vi.mock so the mock is active.
const { buildContextSnapshot } = await import("./snapshot.ts");

const usage: TurnUsage = {
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  subagentTokens: 0,
  toolCallCount: 1,
  stepCount: 1,
};

describe("buildContextSnapshot", () => {
  it("captures the orchestrator model identifier", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [{ role: "user", content: "hi" }],
      totalUsage: usage,
      turnCount: 1,
    });
    expect(snap.model).toMatch(/^anthropic\//);
  });

  it("includes the fully assembled system prompt (with context block)", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [{ role: "user", content: "hi" }],
      totalUsage: usage,
      turnCount: 1,
    });
    expect(snap.systemPrompt).toContain("<execution_context>");
    expect(snap.systemPrompt).toContain("<identity>");
    // Date placeholder was substituted
    expect(snap.systemPrompt).not.toContain("{{DATE}}");
  });

  it("serializes the orchestrator tool surface", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    const names = snap.tools.map((t) => t.name);
    expect(names).toContain("currentTime");
    expect(names).toContain("documentation");
    expect(names).toContain("scheduleTask");
    for (const tool of snap.tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("converts zod input schemas to JSON Schema", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    const currentTime = snap.tools.find((t) => t.name === "currentTime");
    const schema = currentTime?.inputSchema as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema?.type).toBe("object");
    expect(schema?.properties).toBeDefined();
  });

  it("preserves messages and usage verbatim", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const msgs = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "hello" },
    ];
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: msgs,
      totalUsage: usage,
      turnCount: 7,
    });
    expect(snap.messages).toEqual(msgs);
    expect(snap.totalUsage).toEqual(usage);
    expect(snap.turnCount).toBe(7);
  });

  it("stamps updatedAt with an ISO timestamp", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    expect(snap.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("buildContextSnapshot: tool schema serialization", () => {
  it("passes through raw JSON-schema tools verbatim (non-Zod)", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    const raw = snap.tools.find((t) => t.name === "rawJsonSchemaTool");
    expect(raw?.inputSchema).toEqual({
      type: "object",
      properties: { kind: { type: "string" } },
    });
  });

  it("uses an empty object when the tool has no inputSchema", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    const opaque = snap.tools.find((t) => t.name === "toolWithoutSchema");
    expect(opaque?.inputSchema).toEqual({});
  });

  it("returns an empty object when toJSONSchema rejects a zod-like shape", () => {
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const snap = buildContextSnapshot({
      context: ctx.toJSON(),
      messages: [],
      totalUsage: usage,
      turnCount: 1,
    });
    const malformed = snap.tools.find((t) => t.name === "malformedZodLike");
    expect(malformed?.inputSchema).toEqual({});
  });
});
