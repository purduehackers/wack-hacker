import { describe, it, expect, vi } from "vitest";

import { createMockAPI, asAPI, messagePacket } from "../test/fixtures/index.ts";
import { AgentContext } from "./context.ts";
import { truncate, buildPrompt, streamTurn, formatFooter } from "./streaming.ts";

function mockOrchestrator(
  textChunks: string[],
  options?: { toolCallsPerStep?: number; stepCount?: number },
) {
  const stepCount = options?.stepCount ?? 1;
  const toolCallsPerStep = options?.toolCallsPerStep ?? 0;
  return {
    stream: () =>
      Promise.resolve({
        fullStream: (async function* () {
          for (const text of textChunks) {
            yield { type: "text-delta", text };
          }
          yield { type: "finish" };
        })(),
        totalUsage: Promise.resolve({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        }),
        steps: Promise.resolve(
          Array.from({ length: stepCount }, (_, i) => ({
            stepNumber: i,
            toolCalls: Array.from({ length: toolCallsPerStep }, () => ({
              type: "tool-call",
              toolName: "mock",
              args: {},
            })),
          })),
        ),
      }),
  } as any;
}

vi.mock("./orchestrator", () => ({
  createOrchestrator: vi.fn(() => mockOrchestrator(["Hello ", "world!"])),
}));

describe("truncate", () => {
  it("returns short text unchanged", () => {
    expect(truncate("hello")).toBe("hello");
  });

  it("truncates text exceeding 1900 chars", () => {
    const result = truncate("a".repeat(2000));
    expect(result).toHaveLength(1901);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns exactly 1900 chars unchanged", () => {
    expect(truncate("a".repeat(1900))).toHaveLength(1900);
  });

  it("returns empty string unchanged", () => {
    expect(truncate("")).toBe("");
  });
});

function getMessageContent(result: ReturnType<typeof buildPrompt>) {
  if (!("messages" in result) || !result.messages) throw new Error("expected messages");
  return result.messages[0].content;
}

describe("buildPrompt", () => {
  it("returns prompt for text only", () => {
    expect(buildPrompt("hello")).toEqual({ prompt: "hello" });
  });

  it("returns prompt for empty attachments", () => {
    expect(buildPrompt("hello", [])).toEqual({ prompt: "hello" });
  });

  it("builds image parts for image attachment", () => {
    const content = getMessageContent(
      buildPrompt("describe", [
        { url: "https://example.com/img.png", filename: "img.png", contentType: "image/png" },
      ]),
    );
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({ type: "text", text: "describe" });
    expect(content[1].type).toBe("image");
  });

  it("builds file parts for non-image attachment", () => {
    const content = getMessageContent(
      buildPrompt("read", [
        { url: "https://example.com/doc.pdf", filename: "doc.pdf", contentType: "application/pdf" },
      ]),
    );
    if (content[1].type === "file") {
      expect(content[1].filename).toBe("doc.pdf");
      expect(content[1].mediaType).toBe("application/pdf");
    }
  });

  it("defaults mediaType to application/octet-stream", () => {
    const content = getMessageContent(
      buildPrompt("check", [{ url: "https://example.com/blob", filename: "blob" }]),
    );
    if (content[1].type === "file") {
      expect(content[1].mediaType).toBe("application/octet-stream");
    }
  });

  it("handles mixed attachments", () => {
    const content = getMessageContent(
      buildPrompt("mixed", [
        { url: "https://example.com/a.png", filename: "a.png", contentType: "image/png" },
        { url: "https://example.com/b.pdf", filename: "b.pdf", contentType: "application/pdf" },
      ]),
    );
    expect(content).toHaveLength(3);
    expect(content[1].type).toBe("image");
    expect(content[2].type).toBe("file");
  });

  it("treats image/jpeg as image", () => {
    const content = getMessageContent(
      buildPrompt("photo", [
        { url: "https://example.com/p.jpg", filename: "p.jpg", contentType: "image/jpeg" },
      ]),
    );
    expect(content[1].type).toBe("image");
  });
});

describe("streamTurn", () => {
  it("streams text and edits discord message", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", "hello", ctx.toJSON());

    expect(result.text).toBe("Hello world!");
    expect(discord.callsTo("channels.createMessage")[0]).toEqual([
      "ch-1",
      { content: "> Thinking..." },
    ]);

    const edits = discord.callsTo("channels.editMessage");
    expect(edits.length).toBeGreaterThanOrEqual(1);
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("Hello world!");
    expect(body.content).toMatch(/-# .+s · 150 tokens/);
  });

  it("falls back to createMessage when editMessage fails", async () => {
    const discord = createMockAPI();
    discord.channels.editMessage = async () => {
      throw new Error("rate limited");
    };
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", "hello", ctx.toJSON());

    expect(result.text).toBe("Hello world!");
    const sends = discord.callsTo("channels.createMessage");
    expect(sends.length).toBeGreaterThanOrEqual(2);
  });

  it("handles mid-stream edit failure gracefully", async () => {
    const discord = createMockAPI();
    let editCount = 0;
    discord.channels.editMessage = async (_ch: any, _id: any, body: any) => {
      editCount++;
      if (editCount === 1) throw new Error("transient failure");
      return { id: _id, content: body.content, channel_id: _ch } as any;
    };

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", "hello", ctx.toJSON());

    expect(result.text).toBe("Hello world!");
    expect(editCount).toBeGreaterThanOrEqual(2);

    vi.restoreAllMocks();
  });

  it("uses fallback text when stream produces no content", async () => {
    const orchestrator = await import("./orchestrator");
    vi.spyOn(orchestrator, "createOrchestrator").mockReturnValue(mockOrchestrator([]) as any);

    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", "hello", ctx.toJSON());

    expect(result.text).toBe("");
    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("I didn't have anything to say.");
    expect(body.content).toMatch(/-# .+s/);

    vi.restoreAllMocks();
  });
});

describe("formatFooter", () => {
  it("shows all metadata when present", () => {
    expect(
      formatFooter({ elapsedMs: 3200, totalTokens: 1423, toolCallCount: 4, stepCount: 3 }),
    ).toBe("-# 3.2s · 1,423 tokens · 4 tool calls · 3 steps");
  });

  it("omits tool calls when zero", () => {
    expect(
      formatFooter({ elapsedMs: 1000, totalTokens: 500, toolCallCount: 0, stepCount: 1 }),
    ).toBe("-# 1.0s · 500 tokens");
  });

  it("omits steps when only 1", () => {
    expect(
      formatFooter({ elapsedMs: 2500, totalTokens: 800, toolCallCount: 2, stepCount: 1 }),
    ).toBe("-# 2.5s · 800 tokens · 2 tool calls");
  });

  it("uses singular for 1 tool call", () => {
    expect(
      formatFooter({ elapsedMs: 1000, totalTokens: 100, toolCallCount: 1, stepCount: 2 }),
    ).toBe("-# 1.0s · 100 tokens · 1 tool call · 2 steps");
  });

  it("omits tokens when undefined", () => {
    expect(
      formatFooter({ elapsedMs: 500, totalTokens: undefined, toolCallCount: 0, stepCount: 1 }),
    ).toBe("-# 0.5s");
  });
});
