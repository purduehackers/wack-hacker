import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/sandbox/in-memory-sandbox";
import { toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { list_dir } from "./list_dir.ts";

function makeCtx(sandbox: InMemorySandbox): CodingSandboxContext {
  return {
    sandbox,
    repo: "purduehackers/x",
    branch: "phoenix-agent/a",
    repoDir: "/vercel/sandbox",
    threadKey: "T1",
  };
}

function call(
  ctx: CodingSandboxContext,
  input: Parameters<NonNullable<typeof list_dir.execute>>[0],
) {
  return list_dir.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("list_dir tool", () => {
  it("lists entries with their type", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/README.md": "",
        "/vercel/sandbox/src/a.ts": "",
        "/vercel/sandbox/src/b.ts": "",
      },
    });
    const raw = await call(makeCtx(sandbox), { path: "." });
    const parsed = JSON.parse(raw as string);
    const entries = parsed.entries.map(
      (e: { name: string; type: string }) => `${e.name}:${e.type}`,
    );
    expect(entries.sort()).toEqual(["README.md:file", "src:directory"]);
  });

  it("descends into subdirectories", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/src/a.ts": "",
        "/vercel/sandbox/src/b.ts": "",
      },
    });
    const raw = await call(makeCtx(sandbox), { path: "src" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.entries.map((e: { name: string }) => e.name).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("returns an error JSON for missing directories", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), { path: "nope" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/ENOENT/);
  });

  it("refuses directories that escape the repo", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox), { path: "../etc" });
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/outside the repo/);
  });
});
