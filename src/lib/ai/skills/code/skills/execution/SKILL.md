---
name: execution
description: Run shell commands in the sandbox and the repo's verification scripts
criteria: Use when you need to run a shell command that isn't already covered by a dedicated tool (e.g. bun install, git status, custom scripts), OR when you need to validate your changes via typecheck/lint/test
tools: [bash, run_checks, preview_url]
minRole: admin
mode: inline
---

<bash>
- Non-interactive bash (`bash -c`). No TTY.
- Default timeout is 120s. Max is 10 min. Pass `timeout_ms` for longer commands.
- Output is truncated at 50K chars per stream.
- Refused patterns (do not attempt): `rm -rf`, `.env*` touches, `curl | sh`, `wget | sh`, fork bombs, `history`, `ssh-keygen`.
- Do NOT prefix with `cd <working-dir>` — the tool runs in the repo root by default. Use `cwd` only for subdirectories.
- Do NOT run `git commit`, `git push`, or `gh pr create` — the post-finish step handles them.
</bash>

<run_checks>

- Single call that auto-detects the package manager (bun/pnpm/yarn/npm via lockfile) and runs every `typecheck`/`lint`/`test`/`format` script that exists in `package.json`, in parallel.
- Pass `only: ["typecheck"]` to narrow after a targeted fix.
- 5-minute budget per check. Output is tail-truncated — the tool preserves the last 4000 chars per stream.
- If the repo has no `package.json` or no recognized scripts, you'll get a `skipped: true` result — that's fine, move on.
  </run_checks>

<verification-flow>
1. Make a change (edit/write).
2. Call `run_checks`.
3. If anything fails, read the failure, fix the root cause, and re-run `run_checks`.
4. Repeat until green or you hit the same failure three times — then stop and summarize.
</verification-flow>
