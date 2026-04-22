import { describe, expect, it } from "vitest";

import { InMemorySandbox, toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { edit } from "./edit.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(ctx: CodingSandboxContext, input: Parameters<NonNullable<typeof edit.execute>>[0]) {
  return edit.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("edit tool", () => {
  it("replaces a unique occurrence", async () => {
    const sandbox = new InMemorySandbox({
      files: { "/vercel/sandbox/a.ts": "const greeting = 'hello';" },
    });
    const raw = await call(makeCtx(sandbox), {
      path: "a.ts",
      old_string: "hello",
      new_string: "howdy",
      replace_all: false,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.replacements).toBe(1);
    expect(await sandbox.readFile("/vercel/sandbox/a.ts")).toBe("const greeting = 'howdy';");
  });

  it("errors when old_string is not found", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.ts": "abc" } });
    const raw = await call(makeCtx(sandbox), {
      path: "a.ts",
      old_string: "xyz",
      new_string: "zzz",
      replace_all: false,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/not found/);
    expect(await sandbox.readFile("/vercel/sandbox/a.ts")).toBe("abc");
  });

  it("errors when old_string is ambiguous and replace_all is false", async () => {
    const sandbox = new InMemorySandbox({
      files: { "/vercel/sandbox/a.ts": "const x = 1; const x = 2;" },
    });
    const raw = await call(makeCtx(sandbox), {
      path: "a.ts",
      old_string: "const x",
      new_string: "let x",
      replace_all: false,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/2 times/);
  });

  it("replaces all occurrences when replace_all is true", async () => {
    const sandbox = new InMemorySandbox({
      files: { "/vercel/sandbox/a.ts": "const x = 1; const x = 2; const x = 3;" },
    });
    const raw = await call(makeCtx(sandbox), {
      path: "a.ts",
      old_string: "const x",
      new_string: "let x",
      replace_all: true,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.replacements).toBe(3);
    expect(await sandbox.readFile("/vercel/sandbox/a.ts")).toBe("let x = 1; let x = 2; let x = 3;");
  });

  it("errors when old_string and new_string are identical", async () => {
    const sandbox = new InMemorySandbox({ files: { "/vercel/sandbox/a.ts": "same" } });
    const raw = await call(makeCtx(sandbox), {
      path: "a.ts",
      old_string: "same",
      new_string: "same",
      replace_all: false,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/identical/);
  });

  it("refuses paths that escape the repo", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), {
      path: "../etc/passwd",
      old_string: "a",
      new_string: "b",
      replace_all: false,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/outside the repo/);
  });
});
