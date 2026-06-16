import { describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "./types.ts";

import {
  capHistory,
  stampCurrentTime,
  summarizeDroppedHistory,
  truncateForHistory,
} from "./conversation-turn.ts";

const generateText = vi.hoisted(() =>
  vi.fn(async (_opts: { model: string; prompt: string }) => ({ text: "MODEL SUMMARY" })),
);
vi.mock("ai", () => ({ generateText }));

/** Alternating user/assistant turns (even index = user). */
function makeHistory(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
}

describe("truncateForHistory", () => {
  it("returns text under the cap unchanged", () => {
    expect(truncateForHistory("short")).toBe("short");
  });

  it("clips longer text with a marker", () => {
    const out = truncateForHistory("x".repeat(5000));
    expect(out.endsWith("\n[truncated]")).toBe(true);
    expect(out.length).toBeLessThan(5000);
  });
});

describe("stampCurrentTime", () => {
  it("appends the instant when present", () => {
    expect(stampCurrentTime("hey", "2026-06-15T12:00:00Z")).toBe(
      "hey\n\n[current time: 2026-06-15T12:00:00Z]",
    );
  });

  it("returns content unchanged when the instant is absent", () => {
    expect(stampCurrentTime("hey", undefined)).toBe("hey");
  });
});

describe("capHistory", () => {
  it("no-ops when under the cap", async () => {
    const msgs = makeHistory(10);
    const before = [...msgs];
    await capHistory(msgs, async () => "SUMMARY");
    expect(msgs).toEqual(before);
  });

  it("replaces the dropped prefix with one summary message, keeping the latest exchange", async () => {
    const msgs = makeHistory(60);
    await capHistory(msgs, async () => "SUMMARY");
    expect(msgs.length).toBeLessThan(60);
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toContain("SUMMARY");
    expect(msgs.at(-1)?.content).toBe("m59");
  });

  it("falls back to plain dropping (no summary message) when summarize throws", async () => {
    const msgs = makeHistory(60);
    await capHistory(msgs, async () => {
      throw new Error("summary model down");
    });
    expect(msgs.length).toBeLessThan(60);
    expect(msgs.some((m) => m.content.startsWith("[Summary"))).toBe(false);
    expect(msgs.at(-1)?.content).toBe("m59");
  });

  it("advances past a non-user tail to the cap, never dropping the latest exchange", async () => {
    // All-assistant turns: the user-boundary scan walks all the way to the cap
    // (the degenerate-tail guard) instead of finding a user message to stop at.
    const msgs: ChatMessage[] = Array.from({ length: 60 }, (_, i) => ({
      role: "assistant",
      content: `a${i}`,
    }));
    await capHistory(msgs, async () => "SUMMARY");
    expect(msgs.at(-1)?.content).toBe("a59");
    expect(msgs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("summarizeDroppedHistory", () => {
  it("sends the transcript to the summary model and returns its text", async () => {
    const out = await summarizeDroppedHistory([
      { role: "user", content: "ship it?" },
      { role: "assistant", content: "shipped" },
    ]);
    expect(out).toBe("MODEL SUMMARY");
    expect(generateText).toHaveBeenCalledTimes(1);
    const { prompt } = generateText.mock.calls[0][0];
    expect(prompt).toContain("user: ship it?");
    expect(prompt).toContain("assistant: shipped");
  });
});
