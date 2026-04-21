import { describe, expect, it } from "vitest";

import { InMemorySandbox } from "@/lib/sandbox/in-memory-sandbox";
import { toolOpts } from "@/lib/test/fixtures";

import type { CodingSandboxContext } from "./utils.ts";

import { run_checks } from "./run_checks.ts";

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
  input: Parameters<NonNullable<typeof run_checks.execute>>[0] = {},
) {
  return run_checks.execute!(input, { ...toolOpts, experimental_context: ctx });
}

describe("run_checks — package manager detection", () => {
  it("picks bun when bun.lock is present", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
        "/vercel/sandbox/bun.lock": "",
      },
      execHandler: async (command) => {
        expect(command).toBe("bun run typecheck");
        return { exitCode: 0, stdout: "all good", stderr: "", truncated: false };
      },
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.package_manager).toBe("bun");
    expect(parsed.all_passed).toBe(true);
  });

  it("falls back to pnpm → yarn → npm based on lockfile", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({ scripts: { lint: "eslint ." } }),
        "/vercel/sandbox/pnpm-lock.yaml": "",
      },
      execHandler: async (command) => {
        expect(command).toBe("pnpm run lint");
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.package_manager).toBe("pnpm");
  });

  it("defaults to npm when no lockfile exists", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      },
      execHandler: async (command) => {
        expect(command).toBe("npm run test");
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.package_manager).toBe("npm");
  });
});

describe("run_checks — script selection", () => {
  it("runs every candidate script that exists", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({
          scripts: { typecheck: "tsc", lint: "oxlint", test: "vitest", build: "next build" },
        }),
        "/vercel/sandbox/bun.lock": "",
      },
      execHandler: async (command) => ({
        exitCode: 0,
        stdout: command,
        stderr: "",
        truncated: false,
      }),
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    const names = parsed.results.map((r: { name: string }) => r.name).sort();
    expect(names).toEqual(["lint", "test", "typecheck"]);
  });

  it("honors the `only` filter", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({
          scripts: { typecheck: "tsc", lint: "oxlint", test: "vitest" },
        }),
        "/vercel/sandbox/bun.lock": "",
      },
      execHandler: async () => ({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    });
    const raw = await call(makeCtx(sandbox), { only: ["typecheck"] });
    const parsed = JSON.parse(raw as string);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].name).toBe("typecheck");
  });

  it("skips when no candidate scripts exist", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({
          scripts: { build: "next build", dev: "next dev" },
        }),
        "/vercel/sandbox/bun.lock": "",
      },
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.skipped).toBe(true);
    expect(parsed.available_scripts).toEqual(["build", "dev"]);
  });

  it("surfaces failures", async () => {
    const sandbox = new InMemorySandbox({
      files: {
        "/vercel/sandbox/package.json": JSON.stringify({
          scripts: { typecheck: "tsc", lint: "oxlint" },
        }),
        "/vercel/sandbox/bun.lock": "",
      },
      execHandler: async (command) => {
        if (command.includes("typecheck")) {
          return { exitCode: 2, stdout: "", stderr: "Type error on line 5", truncated: false };
        }
        return { exitCode: 0, stdout: "", stderr: "", truncated: false };
      },
    });
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.all_passed).toBe(false);
    expect(parsed.failed_count).toBe(1);
    const failing = parsed.results.find((r: { passed: boolean }) => !r.passed);
    expect(failing.name).toBe("typecheck");
    expect(failing.stderr_tail).toContain("Type error");
  });
});

describe("run_checks — error paths", () => {
  it("returns an error when no package.json exists", async () => {
    const sandbox = new InMemorySandbox();
    const raw = await call(makeCtx(sandbox));
    const parsed = JSON.parse(raw as string);
    expect(parsed.error).toMatch(/no package.json/);
  });
});
