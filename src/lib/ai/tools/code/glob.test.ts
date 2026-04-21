import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/sandbox/in-memory-sandbox";
import { toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { glob } from "./glob.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(ctx: CodingSandboxContext, input: Parameters<NonNullable<typeof glob.execute>>[0]) {
  return glob.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("glob tool", () => {
  it("returns the files printed by rg --files, line-by-line", async () => {
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        expect(command).toContain("rg --files --glob");
        return {
          exitCode: 0,
          stdout: "src/a.ts\nsrc/b.ts\nsrc/c.ts\n",
          stderr: "",
          truncated: false,
        };
      },
    });
    const raw = await call(makeCtx(sandbox), { pattern: "**/*.ts", path: ".", max_results: 100 });
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(3);
    expect(parsed.files).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(parsed.truncated).toBe(false);
  });

  it("runs rg against a repo-relative root so paths come back relative", async () => {
    let invoked = "";
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        invoked = command;
        return { exitCode: 0, stdout: "src/a.ts\n", stderr: "", truncated: false };
      },
    });
    await call(makeCtx(sandbox), { pattern: "**/*.ts", path: ".", max_results: 100 });
    // Root is ".", not the absolute path "/vercel/sandbox".
    expect(invoked).toMatch(/rg --files --glob '\*\*\/\*\.ts' \./);
    expect(invoked).not.toContain("/vercel/sandbox");
  });

  it("converts subdirectory paths to repo-relative before passing to rg", async () => {
    let invoked = "";
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        invoked = command;
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    await call(makeCtx(sandbox), { pattern: "*.ts", path: "src/lib", max_results: 100 });
    expect(invoked).toContain(" src/lib");
    expect(invoked).not.toContain("/vercel/sandbox/src/lib");
  });

  it("marks results as truncated when more than max_results are returned", async () => {
    const sandbox = new InMemorySandbox({
      execHandler: async () => ({
        exitCode: 0,
        stdout: ["a", "b", "c", "d"].join("\n"),
        stderr: "",
        truncated: false,
      }),
    });
    const raw = await call(makeCtx(sandbox), { pattern: "*", path: ".", max_results: 2 });
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(2);
    expect(parsed.truncated).toBe(true);
    expect(parsed.files).toEqual(["a", "b"]);
  });

  it("treats exit code 1 as empty results", async () => {
    const sandbox = new InMemorySandbox({
      execHandler: async () => ({ exitCode: 1, stdout: "", stderr: "", truncated: false }),
    });
    const raw = await call(makeCtx(sandbox), { pattern: "*.none", path: ".", max_results: 100 });
    const parsed = JSON.parse(raw as string);
    expect(parsed.count).toBe(0);
    expect(parsed.files).toEqual([]);
  });

  it("refuses paths outside the repo", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), { pattern: "*", path: "../etc", max_results: 100 });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/outside the repo/);
  });
});
