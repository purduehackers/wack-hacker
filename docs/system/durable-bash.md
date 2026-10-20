# Durable just-bash candidate

This is a default-off candidate for the Eve 0.81.1 runtime. It is not a production
cutover. `DURABLE_BASH_ENABLED=true` selects `wack-durable-bash` for the root and
provider agents. With the flag absent, Eve's native/default environment remains
selected. The Discord gateway supervisor still uses its existing Vercel Sandbox.

The main agent's direct SDK/HTTP tools and inline Markdown skills never call this
provider. A workspace is created only when Eve requests file or command access.
No VM or database connection is needed to prepare the candidate's build artifact.

## Storage and execution

The provider uses the public `defineSandboxProvider` API. Prepared artifacts carry
bounded seed files, not a host cache path. Runtime state holds a version, a SHA-256
scope derived from the Eve session ID and provider protocol, and a random
generation ID. The Turso `agent_workspaces` table contains the actual files.

Each operation restores a private `InMemoryFs`. Mutations capture a complete
snapshot and compare-and-swap its revision. A successful command result, stdout,
or file-write result is released only after the snapshot commits. Overlapping
writers cannot overwrite each other. A stale handle fails and must be reopened;
there is no retry that silently repeats a command against newer files. Read-only
commands avoid the snapshot write when their durable files are unchanged.

An update has a unique commit receipt. If its HTTP response is lost, the adapter
reads the row and accepts success only when that exact receipt is present. A
different receipt or an unavailable read leaves the outcome unconfirmed. Inspect
the durable state before retrying; never claim the operation failed to commit.

Commands receive a virtual filesystem and a small explicit environment. There is
no host mount, inherited `process.env`, credential broker, custom host command,
QuickJS tool bridge, or enabled network transport. JavaScript's `fetch` shim
rejects requests, and its `child_process` shim only runs virtual commands.
Python uses the bundled
CPython/WASM runtime; JavaScript uses QuickJS (`js-exec`, not `node`). Shell, jq,
Python, and QuickJS audit examples run locally without external API calls.

The interpreter runs in the app process and is not a native isolation boundary.
This design uses just-bash's virtual filesystem, interpreted commands and WASM
language runtimes; it does not execute arbitrary host processes. Do not add a
host-backed filesystem or command bridge as a convenience fallback.

## Deliberate semantics and limits

| Surface            | Contract                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistent files   | `/workspace`, `/home`, `/tmp`; binary bytes, empty directories, file/directory modes and modification times survive resume.                                                    |
| Links              | Symbolic links within those roots survive. Hard links are rejected. Symbolic-link mode/timestamps are not preserved.                                                           |
| Shell state        | Each command starts a fresh shell in `/workspace` with the explicit base environment. `cd`, `export`, functions and shell options do not survive commands.                     |
| Files              | At most 3 MiB per file, 4 MiB total, 1,024 entries, 1,024 bytes per path. Large attachments fail explicitly; use a native session or a future artifact backend.                |
| Snapshot transport | At most 6 MiB UTF-8 encoded JSON before a database request. The SQL table also constrains stored length.                                                                       |
| Commands           | 64 KiB source and environment, 256 KiB output, 5,000 commands/loop iterations, 10 seconds execution. Additional hardened interpreter limits apply.                             |
| Uploads            | Byte streams are bounded and cancelled on caller abort, shutdown or the 10-second read deadline.                                                                               |
| Processes          | `spawn` supports the public stream/wait/kill shape for bounded commands. Output is buffered until commit. No durable background processes, ports, native packages or browsers. |
| Text I/O           | UTF-8; use binary I/O for other encodings.                                                                                                                                     |

The virtual filesystem enforces file size before writes and appends. Compound
copy/move operations roll back their partial filesystem changes if they fail.
Command exceptions and cancellation before commit discard the whole operation's
private filesystem. An ordinary nonzero shell exit can still commit legitimate
earlier changes, matching shell semantics. Cancellation after a commit wins cannot
undo that commit.

`stop` and runtime shutdown close the handle, abort outstanding work, and retain
committed files. `delete` and terminal-session cleanup replace the snapshot with
an empty tombstone. Cleanup is idempotent and generation-fenced: an old cleanup
cannot erase a newly opened generation. A cleanup/writer race can cause a stale
CAS failure; Eve retries terminal cleanup, or an explicit delete can be retried.
There is no expiry of active workspaces. Small tombstones are retained indefinitely
to preserve fencing; a retention job requires an authoritative session-retirement
boundary before it may remove them. There is no such cleanup job in this slice.
A crashed or retired session whose terminal cleanup never runs can retain its
full workspace indefinitely. These are bounds per workspace, not a cap on total
database growth; operator reconciliation and global quotas remain release work.

## Release gates

1. Apply additive migration `0001_agent_workspaces.sql` through the normal reviewed
   database path. No live migration was run for this change. Missing tables or
   credentials fail closed; there is no local-disk or Redis fallback.
2. Keep both the old Eve deployment and native sandbox sessions on their existing
   routing until the runtime migration is proven. Eve 0.81.1
   `execution/sandbox/ensure.js` checks saved `providerName` and
   `stateProtocolVersion` before calling `resume`; a mismatch throws. The selector
   is skipped for saved state. Changing this flag on a deployment with existing
   sessions therefore **blocks their sandbox access**, rather than converting or
   transparently rolling them back. Treat the flag as deployment configuration,
   with the same value at build and runtime. Route new sessions deliberately.
3. Compatible redeploys of this provider keep existing files. New seeds initialize
   only a new generation; current build artifacts never overwrite saved bytes.
4. Resolve or explicitly accept Workflow replay semantics before production
   enablement. The public provider context exposes session and turn IDs, and run
   options expose command/cwd/env/abort signal. They expose no tool-call or step
   execution identity. A crash after the filesystem commit but before the Workflow
   checkpoint can repeat `printf event >> replay.log`. The regression test
   deliberately demonstrates `eventevent`. Commit receipts reconcile storage
   responses; they do not provide exactly-once command execution. Command-text
   deduplication would incorrectly suppress intentional repeated commands and is
   not implemented. Idempotent-write guidance alone is not an enforcement fix.
5. Re-run the isolated bundle check below on the Linux deployment artifact, then
   run fresh-host/session, interruption, attachment and cleanup checks in an
   isolated candidate deployment. Local Node/Bun checks do not prove the Vercel
   runtime or network round-trip performance.
6. Measure actual task latency, database traffic and cost with representative
   payloads. Snapshot writes trade bounded database I/O for VM setup. This change
   does not establish a p95 latency improvement. Turso transport limits and regional
   latency still need candidate-deployment verification.

Native escalation is not automatic. A task needing browsers, native builds,
packages, larger files or background work must use an operator-routed native
session. Never stop, delete, migrate or reset existing production resources as a
side effect of selecting this candidate.

## Local verification

`bun test packages/agents/scripts/tests/durable-bash.test.ts` uses a local libSQL
database, including a separate Bun process with an empty environment and no shared
filesystem cache. It covers binary/mode/link preservation, session isolation,
generation fencing, concurrent CAS, ambiguous receipts, cancellation, bounds,
Python and JavaScript computation, host-secret inaccessibility and the replay gate.
The repository lint, formatting, capability and serialization checks also apply.

The root agent's public `build.externalDependencies` setting preserves the
`just-bash` package during Eve's authored-module compilation. Nitro additionally
fully traces the pinned package because Python locates its worker, standard
library and WASM assets dynamically. Nitro-only externalization is too late, and
ordinary dependency tracing alone omits needed Python assets; both failures were
caught by the isolated check.

From `packages/agents`, build with `DURABLE_BASH_ENABLED=true bun run build`, then
run `bun run check:sandbox-bundle /absolute/path/to/node`. The check copies only
the emitted server into a temporary directory outside the checkout, rejects
symlinks escaping the artifact, requires the authored server's external
`just-bash` import, and runs Python date/JSON and QuickJS BigInt computations with
an empty environment. It also enforces a 200 MiB candidate server-artifact budget.
The reviewed macOS arm64 build passed using Node 24.19.0 at 51,097,112 bytes
(48.7 MiB). This is an artifact engine check, not a deployed HTTP/session test;
Linux native dependencies, platform limits and the full session lifecycle still
need the candidate-deployment checks above. Build and runtime must use the same
provider flag. The unchanged native/default build path may require its normal
provider setup or `--skip-sandbox-prewarm` for local validation.
