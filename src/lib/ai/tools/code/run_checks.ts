import { tool } from "ai";
import { z } from "zod";

import type { Sandbox } from "@/lib/sandbox/types";

import { getSandboxContext } from "./utils.ts";

/**
 * Script names we look for in the target repo's `package.json` scripts. Every
 * script that exists is run in parallel; results come back as a per-check
 * pass/fail array. The agent is told (in the skill) to call this after
 * non-trivial changes and to fix root causes before opening a PR.
 */
const CANDIDATE_SCRIPTS = ["typecheck", "lint", "test", "format:check", "format"] as const;

export const run_checks = tool({
  description: `Run the repo's typecheck / lint / test scripts (whichever exist in \`package.json\`) in parallel. Returns per-check pass/fail + output.

Use this after any non-trivial change. If something fails, read the output, fix the root cause, and run again. Do not finish or let a PR open with failing checks unless you have a documented unresolvable blocker.

The package manager is auto-detected from lockfiles (bun → pnpm → yarn → npm). Each check has a 5-minute budget.`,
  inputSchema: z.object({
    only: z
      .array(z.enum(CANDIDATE_SCRIPTS))
      .optional()
      .describe("Run only these scripts. Omit to run every script that exists in package.json."),
  }),
  execute: async ({ only }, { experimental_context, abortSignal }) => {
    const { sandbox, repoDir } = getSandboxContext(experimental_context, "run_checks");

    const manifest = await readPackageJson(sandbox, repoDir);
    if (!manifest) {
      return JSON.stringify({
        error: "no package.json at repo root; run_checks expects a JS/TS project",
      });
    }

    const manager = await detectPackageManager(sandbox, repoDir);
    const scripts = manifest.scripts ?? {};
    const candidates = (only ?? CANDIDATE_SCRIPTS).filter((name) => name in scripts);

    if (candidates.length === 0) {
      return JSON.stringify({
        package_manager: manager,
        skipped: true,
        reason: `no ${(only ?? CANDIDATE_SCRIPTS).join("/")} scripts in package.json`,
        available_scripts: Object.keys(scripts).sort(),
      });
    }

    const results = await Promise.all(
      candidates.map(async (name) => {
        const command = `${manager} run ${name}`;
        const result = await sandbox.exec(command, {
          cwd: repoDir,
          timeoutMs: 5 * 60 * 1000,
          signal: abortSignal,
        });
        return {
          name,
          command,
          passed: result.exitCode === 0,
          exit_code: result.exitCode,
          stdout_tail: tail(result.stdout, 4000),
          stderr_tail: tail(result.stderr, 4000),
          truncated: result.truncated,
        };
      }),
    );

    const failed = results.filter((r) => !r.passed);

    return JSON.stringify({
      package_manager: manager,
      all_passed: failed.length === 0,
      passed_count: results.length - failed.length,
      failed_count: failed.length,
      results,
    });
  },
});

async function readPackageJson(
  sandbox: Sandbox,
  repoDir: string,
): Promise<{ scripts?: Record<string, string> } | null> {
  try {
    const raw = await sandbox.readFile(`${repoDir}/package.json`);
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return parsed;
  } catch {
    return null;
  }
}

async function detectPackageManager(sandbox: Sandbox, repoDir: string): Promise<string> {
  const candidates: { file: string; manager: string }[] = [
    { file: "bun.lockb", manager: "bun" },
    { file: "bun.lock", manager: "bun" },
    { file: "pnpm-lock.yaml", manager: "pnpm" },
    { file: "yarn.lock", manager: "yarn" },
    { file: "package-lock.json", manager: "npm" },
  ];

  for (const { file, manager } of candidates) {
    try {
      await sandbox.stat(`${repoDir}/${file}`);
      return manager;
    } catch {
      // Not found — try next.
    }
  }
  return "npm";
}

function tail(text: string, n: number): string {
  if (text.length <= n) return text;
  return `…${text.slice(-n)}`;
}
