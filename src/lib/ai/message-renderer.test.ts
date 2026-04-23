import { describe, it, expect, vi } from "vitest";

import type { FooterMeta } from "./types.ts";

import { createMockAPI, asAPI } from "../test/fixtures/index.ts";
import { MessageRenderer } from "./message-renderer.ts";

describe("MessageRenderer.formatFooter", () => {
  it("shows elapsed, tokens, and tool calls", () => {
    expect(
      MessageRenderer.formatFooter({
        elapsedMs: 3200,
        totalTokens: 1423,
        toolCallCount: 4,
        stepCount: 3,
      }),
    ).toBe("-# 3.2s · 1,423 tokens · 4 tool calls");
  });

  it("omits tool calls when zero", () => {
    expect(
      MessageRenderer.formatFooter({
        elapsedMs: 1000,
        totalTokens: 500,
        toolCallCount: 0,
        stepCount: 1,
      }),
    ).toBe("-# 1.0s · 500 tokens");
  });

  it("uses singular for 1 tool call", () => {
    expect(
      MessageRenderer.formatFooter({
        elapsedMs: 1000,
        totalTokens: 100,
        toolCallCount: 1,
        stepCount: 2,
      }),
    ).toBe("-# 1.0s · 100 tokens · 1 tool call");
  });

  it("omits tokens when undefined", () => {
    expect(
      MessageRenderer.formatFooter({
        elapsedMs: 500,
        totalTokens: undefined,
        toolCallCount: 0,
        stepCount: 1,
      }),
    ).toBe("-# 0.5s");
  });

  it("puts the trace id first when provided", () => {
    expect(
      MessageRenderer.formatFooter({
        elapsedMs: 500,
        totalTokens: 100,
        toolCallCount: 0,
        stepCount: 1,
        traceId: "abc123def456",
      }),
    ).toBe("-# `abc123def456` · 0.5s · 100 tokens");
  });
});

describe("MessageRenderer.splitText", () => {
  it("returns short text as single chunk", () => {
    expect(MessageRenderer.splitText("hello")).toEqual(["hello"]);
  });

  it("returns empty string as single chunk", () => {
    expect(MessageRenderer.splitText("")).toEqual([""]);
  });

  it("returns text at exactly max length as single chunk", () => {
    const text = "a".repeat(1900);
    expect(MessageRenderer.splitText(text)).toEqual([text]);
  });

  it("splits at paragraph boundaries", () => {
    const p1 = "a".repeat(1000);
    const p2 = "b".repeat(1000);
    const text = `${p1}\n\n${p2}`;
    const chunks = MessageRenderer.splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(p1);
    expect(chunks[1]).toBe(p2);
  });

  it("splits at sentence boundaries when no paragraph break", () => {
    const s1 = "a".repeat(950) + ".";
    const s2 = "b".repeat(1000);
    const text = `${s1} ${s2}`;
    const chunks = MessageRenderer.splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(s1);
    expect(chunks[1]).toBe(s2);
  });

  it("splits at word boundaries when no sentence break", () => {
    const w1 = "word ".repeat(380).trimEnd(); // ~1899 chars
    const text = w1 + " extra";
    const result = MessageRenderer.splitText(text);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const segment of result) {
      expect(segment.length).toBeLessThanOrEqual(1901); // 1900 + ellipsis
    }
  });

  it("hard-splits text with no spaces", () => {
    const text = "a".repeat(3800);
    const chunks = MessageRenderer.splitText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1900);
    expect(chunks[1]).toHaveLength(1900);
  });

  it("caps at 5 messages with truncation", () => {
    const text = "a".repeat(10_000);
    const chunks = MessageRenderer.splitText(text);
    expect(chunks).toHaveLength(5);
    expect(chunks[4].endsWith("…")).toBe(true);
  });

  it("handles text that splits with empty remainder", () => {
    // "a".repeat(10) split at maxLength=10: first chunk is exactly 10, remainder is empty
    const text = "a".repeat(10) + " " + "b".repeat(5);
    const chunks = MessageRenderer.splitText(text, 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toBe("b".repeat(5));
  });

  it("respects custom maxLength", () => {
    const text = "a".repeat(20);
    const chunks = MessageRenderer.splitText(text, 10);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(10);
    expect(chunks[1]).toHaveLength(10);
  });
});

describe("MessageRenderer.splitWithFooter", () => {
  const footer = "-# 1.0s · 100 tokens";

  it("appends footer to short text in single chunk", () => {
    const result = MessageRenderer.splitWithFooter("Hello!", footer);
    expect(result).toEqual([`Hello!\n\n${footer}`]);
  });

  it("splits long text and places footer on last chunk", () => {
    const longText = "a".repeat(3000);
    const result = MessageRenderer.splitWithFooter(longText, footer);
    expect(result.length).toBeGreaterThan(1);
    // Only last chunk has footer
    expect(result[result.length - 1].endsWith(footer)).toBe(true);
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]).not.toContain(footer);
    }
  });

  it("preserves text exactly at available limit", () => {
    const available = 1900 - footer.length - 2; // 2 for "\n\n"
    const text = "a".repeat(available);
    const result = MessageRenderer.splitWithFooter(text, footer);
    expect(result).toEqual([`${text}\n\n${footer}`]);
    expect(result[0]).toHaveLength(1900);
  });

  it("handles footer pushing last chunk over limit", () => {
    // Text that splits into chunks where the last chunk is too long for footer
    const text = "a".repeat(1900) + "b".repeat(1890);
    const result = MessageRenderer.splitWithFooter(text, footer);
    // Every chunk should fit within 1900 chars
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(1901); // allow for ellipsis
    }
    expect(result[result.length - 1]).toContain(footer);
  });

  it("enforces MAX_MESSAGES cap even when re-splitting for footer", () => {
    // 9500 chars of no-space text forces 5 chunks from splitText,
    // then re-splitting the last chunk could exceed 5 total
    const text = "a".repeat(9500);
    const result = MessageRenderer.splitWithFooter(text, footer);
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result[result.length - 1]).toContain(footer);
  });
});

describe("MessageRenderer instance", () => {
  it("init creates thinking placeholder", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();

    const sends = discord.callsTo("channels.createMessage");
    expect(sends).toHaveLength(1);
    expect(sends[0]).toEqual(["ch-1", { content: "> Thinking..." }]);
  });

  it("appendText accumulates text", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();

    await renderer.appendText("Hello ");
    await renderer.appendText("world!");

    expect(renderer.content).toBe("Hello world!");
  });

  it("flush skips edit when content is unchanged", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    // Append empty string — text stays "", render returns "> Thinking..." (same as lastRendered)
    await renderer.appendText("");

    // Only the init createMessage, no edits since rendered content didn't change
    const edits = discord.callsTo("channels.editMessage");
    expect(edits).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("appendText triggers rate-limited edit", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    await renderer.appendText("Hello");

    const edits = discord.callsTo("channels.editMessage");
    expect(edits.length).toBeGreaterThanOrEqual(1);

    vi.restoreAllMocks();
  });
});

describe("MessageRenderer: mid-stream truncation", () => {
  it("truncates long text during streaming to MAX_LENGTH", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    await renderer.appendText("a".repeat(2500));

    const edits = discord.callsTo("channels.editMessage");
    expect(edits.length).toBeGreaterThanOrEqual(1);
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    // Should be truncated to exactly 1900 chars (1899 + ellipsis)
    expect(body.content).toHaveLength(1900);
    expect(body.content.endsWith("…")).toBe(true);

    vi.restoreAllMocks();
  });
});

describe("MessageRenderer: components", () => {
  it("showToolCall renders activity line", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    await renderer.showToolCall("search");

    const edits = discord.callsTo("channels.editMessage");
    const editBodies = edits.map((e) => (e[2] as { content: string }).content);
    expect(editBodies.some((c) => c.includes("Calling `search`..."))).toBe(true);

    vi.restoreAllMocks();
  });

  it("showSubagentPreview renders quoted preview", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    await renderer.showSubagentPreview("Searching...");

    const edits = discord.callsTo("channels.editMessage");
    const editBodies = edits.map((e) => (e[2] as { content: string }).content);
    expect(editBodies.some((c) => c.includes("> Searching..."))).toBe(true);

    vi.restoreAllMocks();
  });

  it("clearActivity clears activity and preview state", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");

    const realNow = Date.now;
    let now = realNow.call(Date);
    vi.spyOn(Date, "now").mockImplementation(() => {
      now += 2000;
      return now;
    });

    await renderer.init();
    await renderer.showToolCall("search");
    renderer.clearActivity();
    await renderer.appendText("Done");

    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toBe("Done");
    expect(body.content).not.toContain("Calling");

    vi.restoreAllMocks();
  });
});

describe("MessageRenderer: finalize", () => {
  it("finalize edits single message with footer for short text", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();
    await renderer.appendText("Hello!");

    const meta: FooterMeta = {
      elapsedMs: 1000,
      totalTokens: 100,
      toolCallCount: 0,
      stepCount: 1,
    };
    await renderer.finalize(meta);

    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("Hello!");
    expect(body.content).toContain("-# 1.0s · 100 tokens");
  });

  it("finalize creates additional messages for long text", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();
    await renderer.appendText("a".repeat(3000));

    const meta: FooterMeta = {
      elapsedMs: 1000,
      totalTokens: 100,
      toolCallCount: 0,
      stepCount: 1,
    };
    await renderer.finalize(meta);

    // Initial "Thinking..." + overflow chunk(s)
    const sends = discord.callsTo("channels.createMessage");
    expect(sends.length).toBeGreaterThanOrEqual(2);
  });

  it("finalize includes task ID in footer", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1", { taskId: "task-42" });
    await renderer.init();
    await renderer.appendText("Hello!");

    const meta: FooterMeta = {
      elapsedMs: 1000,
      totalTokens: 100,
      toolCallCount: 0,
      stepCount: 1,
    };
    await renderer.finalize(meta);

    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("-# Task: task-42");
    expect(body.content).toMatch(/-# .+s · .+\n-# Task: task-42/);
  });
});

describe("MessageRenderer: finalize edge cases", () => {
  it("finalize uses fallback text when no content", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();

    const meta: FooterMeta = {
      elapsedMs: 500,
      totalTokens: undefined,
      toolCallCount: 0,
      stepCount: 1,
    };
    await renderer.finalize(meta);

    const edits = discord.callsTo("channels.editMessage");
    const lastEdit = edits[edits.length - 1];
    const body = lastEdit[2] as { content: string };
    expect(body.content).toContain("I didn't have anything to say.");
  });

  it("finalize falls back to createMessage when edit fails", async () => {
    const discord = createMockAPI();
    discord.channels.editMessage = async () => {
      throw new Error("rate limited");
    };
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    await renderer.init();
    await renderer.appendText("Hello!");

    const meta: FooterMeta = {
      elapsedMs: 1000,
      totalTokens: 100,
      toolCallCount: 0,
      stepCount: 1,
    };
    await renderer.finalize(meta);

    const sends = discord.callsTo("channels.createMessage");
    // Initial + fallback
    expect(sends.length).toBeGreaterThanOrEqual(2);
    const lastSend = sends[sends.length - 1];
    expect((lastSend[1] as { content: string }).content).toContain("Hello!");
  });

  it("finalize throws when called before init()", async () => {
    const discord = createMockAPI();
    const renderer = new MessageRenderer(asAPI(discord), "ch-1");
    const meta: FooterMeta = {
      elapsedMs: 1000,
      totalTokens: 100,
      toolCallCount: 0,
      stepCount: 1,
    };
    await expect(renderer.finalize(meta)).rejects.toThrow(/before init/);
  });
});
