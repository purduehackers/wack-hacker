import { describe, expect, it } from "vitest";

import { InMemorySandbox, toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { read } from "./read.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "wack-hacker/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(ctx: CodingSandboxContext, input: Parameters<NonNullable<typeof read.execute>>[0]) {
  return read.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("read tool", () => {
  it("returns file contents with line numbers", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.txt": "one\ntwo\nthree" } });
    const raw = await call(makeCtx(sandbox), { path: "a.txt" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.path).toBe("a.txt");
    expect(parsed.line_count).toBe(3);
    expect(parsed.content).toContain("    1\tone");
    expect(parsed.content).toContain("    2\ttwo");
    expect(parsed.content).toContain("    3\tthree");
  });

  it("supports offset + limit to read a slice", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/big.txt": lines } });
    const raw = await call(makeCtx(sandbox), { path: "big.txt", offset: 4, limit: 3 });
    const parsed = JSON.parse(raw as string);
    expect(parsed.start_line).toBe(4);
    expect(parsed.end_line).toBe(7);
    expect(parsed.content).toContain("    4\tline 4");
    expect(parsed.content).toContain("    6\tline 6");
    expect(parsed.content).not.toContain("line 7");
  });

  it("propagates a classified error envelope for missing files", async () => {
    const sandbox = new InMemorySandbox();
    const result = await call(makeCtx(sandbox), { path: "missing.txt" });
    expect(String(result)).toMatch(/read failed \(not-found\)/);
    expect(String(result)).toContain("ENOENT: no such file");
  });

  it("propagates a classified error envelope for paths that escape the repo directory", async () => {
    const sandbox = new InMemorySandbox();
    const result = await call(makeCtx(sandbox), { path: "../etc/passwd" });
    expect(String(result)).toMatch(/read failed/);
    expect(String(result)).toContain("resolves outside the repo directory");
  });
});
