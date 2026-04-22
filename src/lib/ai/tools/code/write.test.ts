import { describe, expect, it } from "vitest";

import { InMemorySandbox, toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { write } from "./write.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(ctx: CodingSandboxContext, input: Parameters<NonNullable<typeof write.execute>>[0]) {
  return write.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("write tool", () => {
  it("creates a new file", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), { path: "NEW.md", content: "hello" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.created).toBe(true);
    expect(parsed.overwritten).toBe(false);
    expect(parsed.path).toBe("NEW.md");
    expect(await sandbox.readFile("/vercel/sandbox/NEW.md")).toBe("hello");
  });

  it("overwrites an existing file", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.txt": "old" } });
    const raw = await call(makeCtx(sandbox), { path: "a.txt", content: "new" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.created).toBe(false);
    expect(parsed.overwritten).toBe(true);
    expect(await sandbox.readFile("/vercel/sandbox/a.txt")).toBe("new");
  });

  it("refuses paths that escape the repo", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), { path: "../outside.txt", content: "x" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/outside the repo/);
  });

  it("creates parent directories for deep paths", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), {
      path: "src/deep/nested/file.ts",
      content: "export {};",
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.created).toBe(true);
    expect(await sandbox.readFile("/vercel/sandbox/src/deep/nested/file.ts")).toBe("export {};");
  });
});
