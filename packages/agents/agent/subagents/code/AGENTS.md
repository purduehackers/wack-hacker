# `code` — notes for changing this subagent

Written for whoever extends it, not for the agent that runs it. Runtime guidance
belongs in `instructions.md`; this is where the machinery will surprise you.

## Why it looks nothing like the twelve provider domains

There is no client, no tool registry, no skill catalog. It has two real tools and
seven three-line files that call `disableTool()`. Those seven are load-bearing:
Eve offers `bash`, `read_file`, `write_file`, `glob`, `grep`, `web_fetch`, and
`web_search` by default, and deleting one of those files silently re-enables it
next to a harness that already owns the filesystem. `check-capabilities` models
this subagent as **auxiliary** for the same reason — declaring neither a skill
catalog nor a tool registry is allowed; declaring half of one is not.

## One sandbox, and how Codex gets into it

`sandbox.ts` is the only authored sandbox in the tree. `lib/harness.ts` hands it
to the Codex adapter rather than letting the adapter make its own:

```ts
const sandbox = await Sandbox.get({ name: eveSession.id, resume: false });
createVercelSandbox({ sandbox, bridgePorts: [CODE_SANDBOX_BRIDGE_PORT] });
```

Three things about that are easy to get wrong.

**`Sandbox.get({ name: session.id })` relies on an undocumented correspondence.**
Eve names its Vercel sandboxes after the session key and returns that same string
as `SandboxSession.id` (`execution/sandbox/bindings/vercel.js`: `createHandle`
passes `sessionKey` through as `id`, and `ensureSession` names the sandbox with
it). It is an implementation detail, not a contract. It fails closed — a changed
convention yields a 404, never a handle to somebody else's sandbox — but if a
version bump starts reporting "this session's sandbox could not be reached", look
here first.

**Passing `sandbox` selects a different code path in the adapter.** The wrapping
branch of `VercelSandboxProvider` sets `ownsLifecycle: false`, which turns
`stop()` and `destroy()` into no-ops. That is what makes it safe for the harness
to tear down its session in a `finally` block. Drop the `sandbox` key and the
adapter silently goes back to creating and destroying VMs of its own.

**`bridgePorts` must name a port `sandbox.ts` actually exposed.** Ports are fixed
at create time on Vercel. `getPortUrl` throws `HarnessCapabilityUnsupportedError`
for a port that is not in `sandbox.routes`, and the failure surfaces as a bridge
startup timeout rather than as anything about ports. Both sides read
`CODE_SANDBOX_BRIDGE_PORT` from `lib/constants.ts` so they cannot drift.

## The backend is pinned on purpose

`vercel()`, not `defaultBackend()`. The Codex adapter reaches its in-sandbox
bridge over a public port URL, and only the Vercel backend hands one out —
Docker honors just `allow-all`/`deny-all` and exposes no routes, just-bash has no
network isolation at all. On either of those the harness has no way in. This does
mean local `eve dev` provisions a hosted sandbox for this subagent; that is the
same thing it did before, just now visible in the sandbox definition.

## What is parked, and what is not

`codeHarnessState` parks the Codex _conversation_ — `repo`, `repoRoot`,
`checkoutSha`, and the adapter's opaque resume payload as JSON text. It does not
park the sandbox, because the sandbox is Eve's and outlives the record.

`checkoutSha` is captured once and carried across resumes rather than re-read.
Publication uses it as the floor of the diff it scans for secrets; re-reading
HEAD would silently move that floor after the first commit.

`CodeHarnessSandboxLost` is much rarer than its name suggests. It used to cover a
sandbox timing out on its own — Eve resumes those with the filesystem intact.
What is left is Eve _replacing_ the session's sandbox, which it does when the
sandbox definition itself changes, landing the session on a fresh filesystem.
`attachParkedCodeHarnessSandbox` proves the checkout is still there with a
`test -d <repoRoot>/.git` before publication commits anything.

## Egress is `allow-all`, deliberately

The old allow-list enumerated package registries someone had thought of, so a
task needing a private mirror, a git dependency, or an unlisted toolchain failed
in a way that looked like a broken repository. The real boundary is that this
subagent is admin-only and every mutation needs approval. The sandbox holds no
credential: `withGitHubPushCredentials` narrows egress _only_ for the duration of
a push so the firewall can inject the installation token as an `authorization`
header, and git never sees the value. Restoring the policy afterwards runs on
both the success and the failure path, and a failed restore escalates to
`deny-all` rather than leaving the transform live.

## Things that will bite

`session.run()` returns a `PromiseLike`, not a `Promise` — no `.catch()`, use
`try`/`await`.

`permissionMode` must stay `"allow-all"`. Codex cannot emit approval requests for
its own built-ins, so anything else makes `doStart` throw. The gate is the Eve
tool approval on `code_task`, not the harness.

`createCodex({ auth: { gateway: {} } })` is explicit for a reason: with `auth`
omitted the adapter falls through to the OpenAI API whenever no gateway key is in
the environment, which is the wrong endpoint for this deployment.

The parked resume payload is written with a bare `JSON.stringify`, not
`z.encode`. By that point the harness session is already detached and `parked` is
already set, so a validation throw would skip teardown; an unreadable payload
instead degrades to a fresh conversation against the same checkout.
