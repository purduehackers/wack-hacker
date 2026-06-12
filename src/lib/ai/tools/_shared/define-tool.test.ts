import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

import { toolOpts } from "@/lib/test/fixtures";

vi.mock("@/lib/metrics", () => ({
  countMetric: vi.fn(),
}));

import { countMetric } from "@/lib/metrics";

import { getApprovalOptions, hasApprovalMarker } from "../../approvals/index.ts";
import { filterAdmin } from "../../skills/admin.ts";
import { classifyToolError, defineTool, getToolMeta } from "./define-tool.ts";

function makeTool(
  execute: (input: { q?: string }) => Promise<unknown>,
  overrides: Partial<{
    access: Parameters<typeof defineTool>[0]["access"];
    outputBudget: number;
  }> = {},
) {
  return defineTool({
    name: "test_tool",
    domain: "testing",
    description: "A test tool.",
    access: overrides.access ?? "open",
    input: z.object({ q: z.string().optional() }),
    outputBudget: overrides.outputBudget,
    execute,
  });
}

async function run(t: ReturnType<typeof makeTool>, input: { q?: string } = {}) {
  return (await t.execute!(input, toolOpts)) as string;
}

beforeEach(() => {
  vi.mocked(countMetric).mockClear();
});

describe("defineTool — passthrough", () => {
  it("returns string results untouched and preserves description/schema", async () => {
    const t = makeTool(async () => JSON.stringify({ ok: true }));
    expect(t.description).toBe("A test tool.");
    expect(await run(t)).toBe(JSON.stringify({ ok: true }));
  });

  it("serializes non-string results to JSON", async () => {
    const t = makeTool(async () => ({ value: 7 }));
    expect(await run(t)).toBe('{"value":7}');
  });

  it("counts tool.called with domain and tool attrs", async () => {
    const t = makeTool(async () => "ok");
    await run(t);
    expect(countMetric).toHaveBeenCalledWith("tool.called", {
      domain: "testing",
      tool: "test_tool",
    });
  });

  it("stamps retrievable tool meta", () => {
    const t = makeTool(async () => "ok");
    expect(getToolMeta(t)).toEqual({
      name: "test_tool",
      domain: "testing",
      access: "open",
      outputBudget: 4000,
    });
    expect(getToolMeta({})).toBeNull();
  });
});

describe("defineTool — error envelope", () => {
  it("returns a model-actionable string instead of throwing", async () => {
    const t = makeTool(async () => {
      throw new Error("Repository 'x' not found");
    });
    const out = await run(t);
    expect(out).toContain("test_tool failed (not-found)");
    expect(out).toContain("Repository 'x' not found");
    expect(out).not.toContain("at "); // no stack frames
  });

  it("counts tool.error with the error class", async () => {
    const t = makeTool(async () => {
      throw Object.assign(new Error("nope"), { status: 429 });
    });
    await run(t);
    expect(countMetric).toHaveBeenCalledWith("tool.error", {
      domain: "testing",
      tool: "test_tool",
      class: "rate-limit",
    });
  });

  it("keeps only the first line of multi-line errors", async () => {
    const t = makeTool(async () => {
      throw new Error("boom\n    at someFrame (file.ts:1:1)");
    });
    const out = await run(t);
    expect(out).toContain("boom");
    expect(out).not.toContain("someFrame");
  });
});

describe("classifyToolError", () => {
  it.each([
    [{ status: 404 }, "not-found"],
    [{ status: 403 }, "permission"],
    [{ status: 401 }, "permission"],
    [{ status: 429 }, "rate-limit"],
    [{ status: 422 }, "invalid-input"],
    [{ status: 500 }, "transient"],
    [{ response: { status: 404 } }, "not-found"],
    [{ statusCode: 503 }, "transient"],
  ])("classifies status shape %j as %s", (shape, expected) => {
    expect(classifyToolError(Object.assign(new Error("x"), shape))).toBe(expected);
  });

  it.each([
    ["Channel does not exist", "not-found"],
    ["Forbidden: insufficient scope", "permission"],
    ["rate limit exceeded, retry later", "rate-limit"],
    ["Invalid request body", "invalid-input"],
    ["fetch failed: ECONNRESET", "transient"],
    ["request timed out after 15s", "transient"],
    ["SerpAPI returned 500", "transient"],
    ["something inscrutable", "unknown"],
  ])("classifies message %j as %s", (message, expected) => {
    expect(classifyToolError(new Error(message))).toBe(expected);
  });

  it("classifies zod errors as invalid-input", () => {
    const result = z.object({ n: z.number() }).safeParse({ n: "no" });
    expect(result.success).toBe(false);
    if (!result.success) expect(classifyToolError(result.error)).toBe("invalid-input");
  });
});

describe("defineTool — output budget", () => {
  it("leaves under-budget output alone", async () => {
    const t = makeTool(async () => "short", { outputBudget: 100 });
    expect(await run(t)).toBe("short");
  });

  it("drops trailing items from a root array and appends the marker", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, pad: "x".repeat(40) }));
    const t = makeTool(async () => items, { outputBudget: 800 });
    const out = await run(t);
    const [json, marker] = out.split("\n");
    const kept = JSON.parse(json!) as unknown[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(50);
    expect(marker).toMatch(
      /^\[truncated — \d+ of 50 items shown; refine your query or paginate\]$/,
    );
    expect(out.length).toBeLessThanOrEqual(800);
  });

  it("shrinks an object's single array field, keeping the other fields", async () => {
    const t = makeTool(
      async () => ({
        query: "widgets",
        count: 30,
        products: Array.from({ length: 30 }, (_, i) => ({ asin: `B${i}`, pad: "y".repeat(60) })),
      }),
      { outputBudget: 700 },
    );
    const out = await run(t);
    const [json, marker] = out.split("\n");
    const parsed = JSON.parse(json!) as { query: string; count: number; products: unknown[] };
    expect(parsed.query).toBe("widgets");
    expect(parsed.count).toBe(30);
    expect(parsed.products.length).toBeLessThan(30);
    expect(marker).toContain(`of 30 items shown`);
  });

  it("falls back to a character cut for non-list payloads", async () => {
    const t = makeTool(async () => ({ blob: "z".repeat(5000) }), { outputBudget: 300 });
    const out = await run(t);
    expect(out).toContain("[truncated — 300 of ");
    expect(out).toContain("chars shown; refine your query or paginate]");
  });

  it("falls back to a character cut when multiple arrays are candidates", async () => {
    const t = makeTool(
      async () => ({
        a: Array.from({ length: 40 }, () => "p".repeat(20)),
        b: Array.from({ length: 40 }, () => "q".repeat(20)),
      }),
      { outputBudget: 400 },
    );
    const out = await run(t);
    expect(out).toContain("chars shown; refine your query or paginate]");
  });
});

describe("defineTool — access", () => {
  it("open tools carry no markers", () => {
    const t = makeTool(async () => "ok");
    expect(hasApprovalMarker(t)).toBe(false);
    expect(Object.keys(filterAdmin({ test_tool: t }))).toEqual(["test_tool"]);
  });

  it("admin tools are stripped by filterAdmin", () => {
    const t = makeTool(async () => "ok", { access: "admin" });
    expect(filterAdmin({ test_tool: t })).toEqual({});
  });

  it("approval tools carry the approval marker with default options", () => {
    const t = makeTool(async () => "ok", { access: "approval" });
    expect(getApprovalOptions(t)).toEqual({});
  });

  it("approval tools carry explicit ApprovalOptions", () => {
    const t = makeTool(async () => "ok", { access: { approval: { reason: "irreversible" } } });
    expect(getApprovalOptions(t)).toEqual({ reason: "irreversible" });
  });
});
