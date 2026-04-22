import { describe, expect, it } from "vitest";

import type { ApprovalState } from "./types.ts";

import {
  buildApprovalComponents,
  buildApprovalEmbed,
  buildDecisionEmbed,
  formatToolCall,
} from "./helpers.ts";

describe("formatToolCall", () => {
  it("renders dot notation for delegate tools", () => {
    const out = formatToolCall("github", "create_pr", {
      title: "Fix bug",
      branch: "fix/bug",
    });
    expect(out).toBe(`delegate_github.create_pr(\n    title="Fix bug",\n    branch="fix/bug",\n)`);
  });

  it("renders bare tool name when no delegate is set", () => {
    const out = formatToolCall(undefined, "send_message", { content: "hi" });
    expect(out).toBe(`send_message(\n    content="hi",\n)`);
  });

  it("omits parens body when input is empty", () => {
    expect(formatToolCall(undefined, "ping", {})).toBe("ping()");
  });

  it("strips _reason before rendering", () => {
    const out = formatToolCall(undefined, "x", { keep: 1, _reason: "because" });
    expect(out).toBe(`x(\n    keep=1,\n)`);
  });

  it("treats array inputs as empty-kwargs calls", () => {
    expect(formatToolCall(undefined, "x", [1, 2, 3])).toBe("x()");
  });

  it("truncates long string values with an ellipsis", () => {
    const long = "x".repeat(500);
    const out = formatToolCall(undefined, "t", { big: long });
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(300);
  });

  it("serializes nested objects as JSON", () => {
    const out = formatToolCall(undefined, "t", { opts: { a: 1, b: true } });
    expect(out).toContain(`opts={"a":1,"b":true}`);
  });

  it("renders undefined values as 'undefined' (not 'null')", () => {
    const out = formatToolCall(undefined, "t", { maybe: undefined });
    expect(out).toContain("maybe=undefined");
  });

  it("falls back to String() when JSON.stringify throws (circular)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const out = formatToolCall(undefined, "t", { ref: circular });
    // Should not throw; renders using String()
    expect(out).toContain("ref=");
  });

  it("truncates long non-string values with a trailing ellipsis (no trailing quote)", () => {
    const longArray = Array.from({ length: 500 }, (_, i) => i);
    const out = formatToolCall(undefined, "t", { nums: longArray });
    expect(out).toContain("…");
    expect(out).not.toContain(`…"`);
  });
});

describe("buildApprovalEmbed", () => {
  it("uses amber color and includes the reason", () => {
    const embed = buildApprovalEmbed({
      toolName: "ping",
      input: {},
      reason: "testing",
      timeoutMs: 240_000,
    });
    expect(embed.color).toBe(0xffaa00);
    expect(embed.fields?.[0]).toEqual({ name: "Reason", value: "testing" });
    expect(embed.footer?.text).toMatch(/auto-denies in 4m/);
  });

  it("falls back to a placeholder when the reason is blank", () => {
    const embed = buildApprovalEmbed({
      toolName: "ping",
      input: {},
      reason: "",
      timeoutMs: 60_000,
    });
    expect(embed.fields?.[0]?.value).toBe("(not provided)");
  });

  it("embeds the tool call in a py code block", () => {
    const embed = buildApprovalEmbed({
      delegateName: "github",
      toolName: "create_pr",
      input: { title: "fix" },
      reason: "r",
      timeoutMs: 240_000,
    });
    expect(embed.description).toContain("```py\ndelegate_github.create_pr(");
  });
});

describe("buildApprovalComponents", () => {
  it("returns an action row with Approve + Deny buttons carrying the id", () => {
    const [row] = buildApprovalComponents("abc123");
    expect(row.type).toBe(1);
    expect(row.components).toHaveLength(2);
    const ids = row.components.map((c) => (c as { custom_id: string }).custom_id);
    expect(ids).toEqual(["tool-approval:approve:abc123", "tool-approval:deny:abc123"]);
  });
});

describe("buildDecisionEmbed", () => {
  const state: ApprovalState = {
    id: "x",
    status: "approved",
    toolName: "ping",
    input: {},
    reason: "r",
    channelId: "ch-1",
    requesterUserId: "user-1",
    createdAt: "2024-01-01T00:00:00Z",
    decidedAt: "2024-01-01T00:01:00Z",
  };

  it("green color + Decided by field for approved", () => {
    const e = buildDecisionEmbed(state, "approved", "user-1");
    expect(e.color).toBe(0x34d399);
    const decided = e.fields?.find((f) => f.name === "Decided by");
    expect(decided?.value).toBe("<@user-1>");
  });

  it("red color for denied", () => {
    const e = buildDecisionEmbed(state, "denied", "user-1");
    expect(e.color).toBe(0xef4444);
  });

  it("grey color + no Decided-by for timeout", () => {
    const e = buildDecisionEmbed(state, "timeout", null);
    expect(e.color).toBe(0x9ca3af);
    expect(e.fields?.find((f) => f.name === "Decided by")).toBeUndefined();
    expect(e.footer?.text).toMatch(/Timed Out.*auto-expired/);
  });
});
