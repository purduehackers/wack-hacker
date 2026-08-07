import { describe, expect, test } from "bun:test";

import { renderFooter } from "./render-intent.ts";

describe("Discord terminal footer", () => {
  test("accounts for duration, tokens, tool calls, and the support reference", () => {
    expect(
      renderFooter({
        referenceId: "abc12345",
        durationMs: 1_250,
        tokens: 12_345,
        toolCalls: 2,
      }),
    ).toBe("`abc12345` · 1.3s · 12,345 tokens · 2 tool calls");
  });
});
