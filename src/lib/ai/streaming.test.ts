import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

import type { ChatMessage } from "./types.ts";

import {
  asAPI,
  createMockAPI,
  discordRESTClass,
  installMockProvider,
  linearClientClass,
  messagePacket,
  notionClientClass,
  octokitClass,
  resendClass,
  streamingTextModel,
  uninstallMockProvider,
} from "../test/fixtures/index.ts";

// Third-party SDK mocks — streaming.ts transitively imports the real tool
// modules via ./orchestrator, and those modules instantiate SDK clients at
// import time.
vi.mock("@linear/sdk", () => ({ LinearClient: linearClientClass() }));
vi.mock("octokit", () => ({ Octokit: octokitClass() }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn(() => ({})) }));
vi.mock("@discordjs/rest", () => ({ REST: discordRESTClass() }));
vi.mock("@notionhq/client", () => ({ Client: notionClientClass() }));
vi.mock("resend", () => ({ Resend: resendClass() }));
vi.mock("@vercel/edge-config", () => ({
  createClient: vi.fn(() => ({ getAll: vi.fn().mockResolvedValue({}) })),
}));

const { AgentContext } = await import("./context.ts");
const { buildUserMessage, parseModelSlug, streamTurn } = await import("./streaming.ts");
type OrchestratorFactory = import("./streaming.ts").OrchestratorFactory;

type StreamEvent = Record<string, unknown>;

/**
 * Build a test-owned fake orchestrator that emits pre-scripted stream events.
 * Not a mock of our production orchestrator — a stand-in implementation of the
 * `OrchestratorFactory` contract supplied to `streamTurn` via DI.
 */
function fakeOrchestrator(
  textChunks: string[],
  options?: {
    toolCallsPerStep?: number;
    stepCount?: number;
    extraEvents?: StreamEvent[];
    textParts?: string[][];
    totalUsage?: Promise<unknown>;
    steps?: Promise<unknown>;
    captureInput?: (input: unknown) => void;
  },
): OrchestratorFactory {
  const stepCount = options?.stepCount ?? 1;
  const toolCallsPerStep = options?.toolCallsPerStep ?? 0;
  const agent = {
    stream: (input: unknown) => {
      options?.captureInput?.(input);
      return Promise.resolve({
        fullStream: (async function* () {
          for (const evt of options?.extraEvents ?? []) yield evt;
          if (options?.textParts) {
            for (let i = 0; i < options.textParts.length; i++) {
              const id = `t${i}`;
              yield { type: "text-start", id };
              for (const text of options.textParts[i]) {
                yield { type: "text-delta", id, text };
              }
              yield { type: "text-end", id };
            }
          } else {
            for (const text of textChunks) {
              yield { type: "text-delta", text };
            }
          }
          yield { type: "finish" };
        })(),
        totalUsage:
          options?.totalUsage ??
          Promise.resolve({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }),
        steps:
          options?.steps ??
          Promise.resolve(
            Array.from({ length: stepCount }, (_, i) => ({
              stepNumber: i,
              toolCalls: Array.from({ length: toolCallsPerStep }, () => ({
                type: "tool-call",
                toolName: "mock",
                args: {},
              })),
            })),
          ),
      });
    },
  };
  return () => agent as unknown as ReturnType<OrchestratorFactory>;
}

const userMsg = (content: string): ChatMessage[] => [{ role: "user", content }];

describe("buildUserMessage", () => {
  it("returns a plain user message for text only", () => {
    expect(buildUserMessage("hello")).toEqual({ role: "user", content: "hello" });
  });

  it("returns a plain user message for empty attachments", () => {
    expect(buildUserMessage("hello", [])).toEqual({ role: "user", content: "hello" });
  });

  it("builds image parts for image attachment", () => {
    const msg = buildUserMessage("describe", [
      { url: "https://example.com/img.png", filename: "img.png", contentType: "image/png" },
    ]);
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string }>;
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "describe" });
    expect(parts[1].type).toBe("image");
  });

  it("builds file parts for non-image attachment", () => {
    const msg = buildUserMessage("read", [
      { url: "https://example.com/doc.pdf", filename: "doc.pdf", contentType: "application/pdf" },
    ]);
    const parts = msg.content as Array<{ type: string; filename?: string; mediaType?: string }>;
    expect(parts[1].type).toBe("file");
    expect(parts[1].filename).toBe("doc.pdf");
    expect(parts[1].mediaType).toBe("application/pdf");
  });

  it("defaults mediaType to application/octet-stream", () => {
    const msg = buildUserMessage("check", [{ url: "https://example.com/blob", filename: "blob" }]);
    const parts = msg.content as Array<{ type: string; mediaType?: string }>;
    expect(parts[1].mediaType).toBe("application/octet-stream");
  });

  it("handles mixed attachments", () => {
    const msg = buildUserMessage("mixed", [
      { url: "https://example.com/a.png", filename: "a.png", contentType: "image/png" },
      { url: "https://example.com/b.pdf", filename: "b.pdf", contentType: "application/pdf" },
    ]);
    const parts = msg.content as Array<{ type: string }>;
    expect(parts).toHaveLength(3);
    expect(parts[1].type).toBe("image");
    expect(parts[2].type).toBe("file");
  });

  it("treats image/jpeg as image", () => {
    const msg = buildUserMessage("photo", [
      { url: "https://example.com/p.jpg", filename: "p.jpg", contentType: "image/jpeg" },
    ]);
    const parts = msg.content as Array<{ type: string }>;
    expect(parts[1].type).toBe("image");
  });
});

describe("streamTurn: basic text rendering", () => {
  it("streams text and edits discord message", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Hello ", "world!"]),
    });

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

  it("adopts placeholderMessageId instead of posting a new placeholder", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      placeholderMessageId: "pre-posted-1",
      createAgent: fakeOrchestrator(["Hello!"]),
    });

    // The renderer edits the pre-posted placeholder during streaming and on
    // finalize; it never calls createMessage for the placeholder. (A
    // createMessage could still happen as an overflow chunk, but not for the
    // placeholder — and this turn's response is short enough that it won't.)
    const sends = discord.callsTo("channels.createMessage");
    expect(sends).toHaveLength(0);

    const edits = discord.callsTo("channels.editMessage");
    expect(edits.length).toBeGreaterThanOrEqual(1);
    expect(edits[edits.length - 1][1]).toBe("pre-posted-1");
    expect(result.discordMessageId).toBe("pre-posted-1");
  });

  it("includes task ID in footer when taskId is provided", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      taskId: "task-abc-123",
      createAgent: fakeOrchestrator(["Hello ", "world!"]),
    });

    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("-# Task: task-abc-123");
    expect(body.content).toMatch(/-# .+s · .+\n-# Task: task-abc-123/);
  });
});

describe("streamTurn: edit fallback + empty stream", () => {
  it("falls back to createMessage when editMessage fails", async () => {
    const discord = createMockAPI();
    discord.channels.editMessage = async () => {
      throw new Error("rate limited");
    };
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Hello ", "world!"]),
    });

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
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Hello ", "world!"]),
    });

    expect(result.text).toBe("Hello world!");
    expect(editCount).toBeGreaterThanOrEqual(2);

    vi.restoreAllMocks();
  });

  it("uses fallback text when stream produces no content", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator([]),
    });

    expect(result.text).toBe("");
    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("I didn't have anything to say.");
    expect(body.content).toMatch(/-# .+s/);
  });
});

describe("streamTurn: multi-message splitting", () => {
  it("splits long responses across multiple messages", async () => {
    const longText = "a".repeat(3000);
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator([longText]),
    });

    const sends = discord.callsTo("channels.createMessage");
    expect(sends.length).toBeGreaterThanOrEqual(2);
  });
});

describe("streamTurn: tool events and metadata", () => {
  it("shows tool activity for tool-input-start events", async () => {
    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Done."], {
        extraEvents: [{ type: "tool-input-start", toolName: "search_entities" }],
      }),
    });

    const edits = discord.callsTo("channels.editMessage");
    const editBodies = edits.map((e) => (e[2] as { content: string }).content);
    expect(editBodies.some((c) => c.includes("Calling `search_entities`"))).toBe(true);

    vi.restoreAllMocks();
  });

  it("shows subagent preview for preliminary tool-result events", async () => {
    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Final answer."], {
        extraEvents: [
          { type: "tool-input-start", toolName: "delegate_linear" },
          {
            type: "tool-result",
            preliminary: true,
            output: {
              parts: [{ type: "text", text: "Searching Linear..." }],
            },
          },
          { type: "tool-result", preliminary: false, output: null },
        ],
      }),
    });

    const edits = discord.callsTo("channels.editMessage");
    const editBodies = edits.map((e) => (e[2] as { content: string }).content);
    expect(editBodies.some((c) => c.includes("Searching Linear..."))).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("streamTurn: tool event edge cases", () => {
  it("ignores empty subagent preview from preliminary tool-result", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Done."], {
        extraEvents: [
          {
            type: "tool-result",
            preliminary: true,
            output: { parts: [{ type: "text", text: "" }] },
          },
        ],
      }),
    });

    expect(result.text).toBe("Done.");
  });

  it("handles undefined totalTokens in usage", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Ok."], {
        totalUsage: Promise.resolve({
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        }),
      }),
    });

    expect(result.text).toBe("Ok.");
    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("0 tokens");
  });

  it("falls back to time-only footer when metadata promises reject", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Response."], {
        totalUsage: Promise.reject(new Error("usage unavailable")),
        steps: Promise.reject(new Error("steps unavailable")),
      }),
    });

    expect(result.text).toBe("Response.");
    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toMatch(/-# \d+\.\ds$/);
  });
});

describe("streamTurn: multi-part text", () => {
  it("joins text parts from separate steps with a paragraph break", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("remind me"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("remind me"), ctx.toJSON(), {
      createAgent: fakeOrchestrator([], {
        textParts: [
          ["I'll schedule that reminder for you in 2 days (April 23rd)!"],
          ["Done! I'll ping you on April 23rd."],
        ],
        extraEvents: [
          { type: "tool-input-start", toolName: "schedule_reminder" },
          { type: "tool-result", preliminary: false, output: null },
        ],
      }),
    });

    expect(result.text).toBe(
      "I'll schedule that reminder for you in 2 days (April 23rd)!\n\n" +
        "Done! I'll ping you on April 23rd.",
    );
    expect(result.text).not.toContain("April 23rd)!Done!");
  });

  it("does not prepend a separator before the first text part", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hi"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hi"), ctx.toJSON(), {
      createAgent: fakeOrchestrator([], { textParts: [["Single reply."]] }),
    });

    expect(result.text).toBe("Single reply.");
    expect(result.text.startsWith("\n")).toBe(false);
  });

  it("keeps deltas within the same part contiguous", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hi"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hi"), ctx.toJSON(), {
      createAgent: fakeOrchestrator([], { textParts: [["Hello ", "world", "!"]] }),
    });

    expect(result.text).toBe("Hello world!");
  });
});

describe("streamTurn: messages array", () => {
  it("passes full conversation history to the agent", async () => {
    let capturedInput: unknown;
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const history: ChatMessage[] = [
      { role: "user", content: "remind me friday" },
      { role: "assistant", content: "what time?" },
      { role: "user", content: "any time works" },
    ];

    await streamTurn(asAPI(discord), "ch-1", history, ctx.toJSON(), {
      createAgent: fakeOrchestrator(["ok"], { captureInput: (i) => (capturedInput = i) }),
    });

    const { messages } = capturedInput as { messages: Array<{ role: string; content: unknown }> };
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "remind me friday" });
    expect(messages[1]).toEqual({ role: "assistant", content: "what time?" });
    expect(messages[2]).toEqual({ role: "user", content: "any time works" });
  });

  it("applies attachments to the last user message only", async () => {
    let capturedInput: unknown;
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(
      messagePacket("hello", {
        attachments: [
          {
            id: "a",
            url: "https://x/a.png",
            filename: "a.png",
            contentType: "image/png",
            size: 1,
          },
        ],
      }),
    );
    const history: ChatMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "latest" },
    ];

    await streamTurn(asAPI(discord), "ch-1", history, ctx.toJSON(), {
      createAgent: fakeOrchestrator(["ok"], { captureInput: (i) => (capturedInput = i) }),
    });

    const { messages } = capturedInput as { messages: Array<{ role: string; content: unknown }> };
    expect(typeof messages[0].content).toBe("string");
    expect(typeof messages[1].content).toBe("string");
    expect(Array.isArray(messages[2].content)).toBe(true);
  });
});

describe("parseModelSlug", () => {
  it("splits a provider/model slug", () => {
    expect(parseModelSlug("anthropic/claude-sonnet-4.6")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4.6",
    });
  });

  it("returns undefined provider for a bare model name", () => {
    expect(parseModelSlug("claude-sonnet-4.6")).toEqual({
      provider: undefined,
      model: "claude-sonnet-4.6",
    });
  });

  it("treats a leading slash as no provider", () => {
    expect(parseModelSlug("/foo")).toEqual({
      provider: undefined,
      model: "/foo",
    });
  });
});

describe("streamTurn: result shape", () => {
  it("returns tool names, model slug, and the discord message id", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Done."], { toolCallsPerStep: 2, stepCount: 2 }),
    });

    expect(result.model).toBe("anthropic/claude-sonnet-4.6");
    // Two steps × two tool calls = four "mock" entries from fakeOrchestrator.
    expect(result.usage.toolNames).toEqual(["mock", "mock", "mock", "mock"]);
    expect(result.discordMessageId).toBe("msg-1");
  });

  it("returns empty toolNames when the turn makes no tool calls", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Hi."]),
    });
    expect(result.usage.toolNames).toEqual([]);
  });

  it("returns the fallback message id when the placeholder edit fails", async () => {
    const discord = createMockAPI();
    discord.channels.editMessage = async () => {
      throw new Error("rate limited");
    };
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Hello!"]),
    });
    // Mock counter starts at 1 for the placeholder; the fallback createMessage
    // is the second call, so `msg-2`.
    expect(result.discordMessageId).toBe("msg-2");
  });
});

describe("streamTurn: stream-event edge cases", () => {
  it("handles tool-input-start without a toolName", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Done."], {
        extraEvents: [{ type: "tool-input-start" }],
      }),
    });
    // No toolName means no activity indicator was appended — the reply text
    // should still be the streamed content, not wrapped in `Calling …`.
    expect(result.text).toBe("Done.");
  });

  it("treats a text-delta without a text field as an empty string", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["First."], {
        extraEvents: [{ type: "text-delta" }],
      }),
    });
    expect(result.text).toBe("First.");
  });

  it("returns empty preview when subagent output has no text parts", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));
    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON(), {
      createAgent: fakeOrchestrator(["Final."], {
        extraEvents: [
          {
            type: "tool-result",
            preliminary: true,
            // Only a non-text part — findLast(isTextUIPart) returns undefined,
            // so the `?? ""` fallback kicks in and the preview is skipped.
            output: { parts: [{ type: "tool-call" }] },
          },
        ],
      }),
    });
    expect(result.text).toBe("Final.");
  });
});

describe("streamTurn: default orchestrator factory", () => {
  // Exercises the `createAgent = createOrchestrator` default so the DI hook's
  // fallback branch doesn't rot. The real orchestrator talks to an AI SDK
  // provider, so we pin it to a mock via `installMockProvider`.
  beforeEach(() => {
    installMockProvider(streamingTextModel("hi there."));
  });

  afterEach(() => {
    uninstallMockProvider();
  });

  it("uses createOrchestrator when no createAgent is provided", async () => {
    const discord = createMockAPI();
    const ctx = AgentContext.fromPacket(messagePacket("hello"));

    const result = await streamTurn(asAPI(discord), "ch-1", userMsg("hello"), ctx.toJSON());

    expect(result.text).toBe("hi there.");
    expect(discord.callsTo("channels.createMessage").length).toBeGreaterThanOrEqual(1);
  });
});
