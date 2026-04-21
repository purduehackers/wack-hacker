import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/sandbox/in-memory-sandbox";
import { toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { grep } from "./grep.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(ctx: CodingSandboxContext, input: Parameters<NonNullable<typeof grep.execute>>[0]) {
  return grep.execute!(input, { ...toolOpts, experimental_context: ctx });
}

function rgMatch(path: string, line: number, text: string): string {
  return JSON.stringify({
    type: "match",
    data: {
      path: { text: path },
      line_number: line,
      lines: { text: `${text}\n` },
    },
  });
}

describe("grep tool — happy path", () => {
  it("parses rg JSON output into structured matches", async () => {
    let invoked: string | undefined;
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        invoked = command;
        return {
          exitCode: 0,
          stdout: [
            rgMatch("src/a.ts", 3, "const foo = 1"),
            rgMatch("src/b.ts", 7, "const foo = 2"),
          ].join("\n"),
          stderr: "",
          truncated: false,
        };
      },
    });

    const raw = await call(makeCtx(sandbox), {
      pattern: "foo",
      path: "src",
      case_insensitive: false,
      max_count: 100,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.match_count).toBe(2);
    expect(parsed.matches[0]).toEqual({
      path: "src/a.ts",
      line_number: 3,
      text: "const foo = 1",
    });
    expect(invoked).toContain("rg --json");
    expect(invoked).toContain("-e foo");
  });
});

describe("grep tool — flags", () => {
  it("treats rg exit code 1 (no matches) as a successful empty result", async () => {
    const sandbox = new InMemorySandbox({
      execHandler: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "",
        truncated: false,
      }),
    });
    const raw = await call(makeCtx(sandbox), {
      pattern: "nothing",
      path: ".",
      case_insensitive: false,
      max_count: 100,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.match_count).toBe(0);
    expect(parsed.matches).toEqual([]);
  });

  it("applies -i when case_insensitive is true", async () => {
    let invoked = "";
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        invoked = command;
        return { exitCode: 1, stdout: "", stderr: "", truncated: false };
      },
    });
    await call(makeCtx(sandbox), {
      pattern: "TODO",
      path: ".",
      case_insensitive: true,
      max_count: 100,
    });
    expect(invoked).toContain(" -i ");
  });

  it("passes --glob when supplied", async () => {
    let invoked = "";
    const sandbox = new InMemorySandbox({
      execHandler: async (command) => {
        invoked = command;
        return { exitCode: 1, stdout: "", stderr: "", truncated: false };
      },
    });
    await call(makeCtx(sandbox), {
      pattern: "x",
      path: ".",
      glob: "**/*.ts",
      case_insensitive: false,
      max_count: 100,
    });
    expect(invoked).toContain("--glob");
    expect(invoked).toContain("**/*.ts");
  });
});

describe("grep tool — error paths", () => {
  it("refuses paths outside the repo", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), {
      pattern: "x",
      path: "../etc",
      case_insensitive: false,
      max_count: 100,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/outside the repo/);
  });

  it("returns an error for non-1 non-0 exit codes", async () => {
    const sandbox = new InMemorySandbox({
      execHandler: async () => ({ exitCode: 2, stdout: "", stderr: "bad regex", truncated: false }),
    });
    const raw = await call(makeCtx(sandbox), {
      pattern: "x",
      path: ".",
      case_insensitive: false,
      max_count: 100,
    });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/exit.*2/);
    expect(parsed.stderr).toContain("bad regex");
  });
});
