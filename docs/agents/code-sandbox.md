# Code sandbox (`delegate_code`)

`delegate_code` is the only subagent that runs a coding loop against a real repository checkout. It is **admin-only** because it takes writes actions on `purduehackers/*` repositories — any organizer can ask it to read code, but only an admin can delegate to it.

Unlike the other delegates, `delegate_code` doesn't just call APIs. It provisions an ephemeral [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox) (a Firecracker microVM), clones the target repo into it, lets the subagent run `read` / `grep` / `edit` / `exec` tools against that filesystem, and commits + opens a PR on the way out.

## Overview

```
  admin mentions @bot ──▶ orchestrator ──▶ delegate_code({ repo, task })
                                                   │
                                                   ▼
                                    buildCodeExperimentalContext
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │ Vercel Sandbox (microVM)    │
                                    │  · git clone <repo>          │
                                    │  · feature branch            │
                                    │  · installation token broker │
                                    └──────────────┬──────────────┘
                                                   │
                                                   ▼
                                    Subagent loop (claude-opus-4.7, 60 steps)
                                    tools: read, grep, glob, list_dir, edit,
                                            exec, todo_write, …
                                                   │
                                                   ▼
                                              codePostFinish
                                                   │
                                       git add -A → commit → push → open PR
                                                   │
                                                   ▼
                                     Subagent's final message +
                                     "**PR**: <url>" appended
```

## Where the pieces live

| File                                      | What it is                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/lib/ai/delegates.ts`                 | `DOMAIN_SPEC_OVERRIDES.code` — model, step cap, schema, context builder, post-finish       |
| `src/lib/ai/tools/code/delegation.ts`     | `codeDelegationInputSchema`, `buildCodeExperimentalContext`, `codePostFinish`              |
| `src/lib/ai/tools/code/`                  | The actual coding tools exposed inside the subagent (`read`, `grep`, `edit`, `exec`, etc.) |
| `src/lib/sandbox/vercel-sandbox.ts`       | `VercelSandbox` — the `Sandbox` interface implementation                                   |
| `src/lib/sandbox/session.ts`              | Redis-backed session registry (one session per Discord thread)                             |
| `src/lib/sandbox/credential-brokering.ts` | Injects GitHub App tokens into outbound traffic via the sandbox network policy             |
| `src/workflows/sandbox-lifecycle.ts`      | Durable workflow that hibernates the sandbox before its timeout fires                      |
| `scripts/create-sandbox-snapshot.ts`      | Builds a base snapshot with `ripgrep` + `gh` preinstalled                                  |

## Sandbox provisioning

`buildCodeExperimentalContext` runs before the subagent starts. It:

1. Resolves a `threadKey` from `agentContext.thread?.id ?? agentContext.channel.id` — this is the idempotency key for the session.
2. Mints a fresh GitHub App installation access token via Octokit (`octokit.auth({ type: "installation" })`).
3. Calls `getOrCreateSession({ threadKey, repo, githubToken, gitUser, baseSnapshotId })`:
   - If Redis has a live session for this thread, it's reused. The subagent picks up the same feature branch from the previous turn.
   - Otherwise a new `VercelSandbox` is created, the repo is cloned, and a feature branch (`phoenix-agent/<slug>-<suffix>`) is checked out.
4. Returns `{ sandbox, repo, branch, repoDir, threadKey }` — this object is wired into every coding tool's `execute(input, runtime)` via `runtime.experimental_context`.

The `Sandbox` interface in `src/lib/sandbox/types.ts` is the contract the coding tools code against. Today the only implementation is `VercelSandbox`, but the abstraction exists so tests can swap in an in-memory fake.

## Credential brokering

The subagent never sees GitHub credentials. Instead, `buildGitHubCredentialBrokeringPolicy(token)` (in `credential-brokering.ts`) produces a sandbox network policy that transparently rewrites outbound traffic to github.com, api.github.com, uploads.github.com, and codeload.github.com — adding an `Authorization` header keyed to the installation token.

This means the subagent runs stock `git push`, `gh pr create`, `curl api.github.com` and auth "just works" without any token being readable from inside the VM. Exfiltration via logs, env vars, or `cat ~/.git-credentials` all fail because the token lives in the network policy, not the filesystem.

## Snapshot optimization

Sandbox cold starts run `dnf install -y ripgrep gh` which takes 20-30 seconds. If `SANDBOX_BASE_SNAPSHOT_ID` is set, `getOrCreateSession` boots from that pre-seeded snapshot instead. Build one by running:

```bash
bun scripts/create-sandbox-snapshot.ts
```

Copy the ID it prints into your Vercel environment as `SANDBOX_BASE_SNAPSHOT_ID`. The app runs fine without it — the var is genuinely optional.

## `codePostFinish`

After the subagent emits its final "Summary" / "Answer" message, `codePostFinish` runs as an async generator that yields additional `UIMessage`s (which the orchestrator surfaces as the subagent's apparent trailing output).

1. `git status --porcelain` — if the working tree is clean, yield "No changes to commit" and return.
2. Parse a commit message. The expected format is a trailing `**Commit message**: <message>` line in the subagent's final text; if that's missing, the first non-empty line is used (truncated to 72 chars).
3. `git add -A && git commit -m <msg>`.
4. `git push -u origin <branch>` (3-minute timeout).
5. Check for an existing open PR (`pulls.list({ head: "<org>:<branch>", state: "open" })`). If there is one, reuse its URL. Otherwise `pulls.create` against the repo's default branch with a body built from:
   - The subagent's final text (minus the trailing `**Commit message**: …` line).
   - An attribution footer naming the Discord user who asked.
6. Yield a final message appending `**PR**: <url>` to the subagent's summary.

If any step fails, the generator yields a short diagnostic and returns — the subagent's own text is still visible to the user, and the feature branch state is whatever it was when the failure occurred.

## Session lifecycle

The lifecycle workflow at `src/workflows/sandbox-lifecycle.ts` runs per-session and hibernates the sandbox about 90 seconds before its timeout fires. Hibernation snapshots the VM's state to Redis with a longer TTL (6 hours) so a paused conversation can resume without losing its branch or working directory. A fully released session (via `releaseSession`) tears the VM down and clears the snapshot.

## When to use `delegate_code`

Only delegate to `code` when the user explicitly asks for code changes to a specific repository — bug fixes, features, refactors, version bumps, test authoring, etc. Read-only questions should go through `delegate_github` instead; the coding sandbox is expensive to spin up and the coding agent is tuned for modifying code rather than summarizing it.
