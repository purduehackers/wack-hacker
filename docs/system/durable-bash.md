# Durable just-bash v2 candidate

This is a default-off candidate for the Eve 0.81.1 runtime. It is not a production
cutover. `DURABLE_BASH_ENABLED=true` selects `wack-durable-bash` for the root and
provider agents. With the flag absent, Eve's native/default environment remains
selected, including the original `bash` and `write_file` definitions and no
`workspace_open` tool. The Discord gateway supervisor still uses its existing
Vercel Sandbox.

The main agent's direct SDK/HTTP tools and inline Markdown skills never call this
provider. A workspace is created only when Eve requests file or command access.
No VM or database connection is needed to prepare the candidate's build artifact.
This candidate uses org-owned infrastructure credentials in trusted adapters;
commands receive none. It adds no MCP or user-account connection flow.

## Storage and execution

The provider uses the public `defineSandboxProvider` API. Prepared artifacts carry
bounded seed files, not a host cache path. Runtime state holds a version, a SHA-256
scope derived from the Eve session ID and provider protocol, and a random
generation ID. The Turso `agent_workspaces` table contains the actual files.

`workspace_open` calls Eve's public `ctx.getSandbox()` once before the first
`bash` or `write_file`. Existing `read_file` access and inbound attachment staging
also initialize the workspace. This retains the provider's prepared seeds,
session scope, generation and cleanup lifecycle. The workflow helpers only open
an existing reference; they never create an alternative unseeded workspace.

The root and all twelve specialist agents replace `bash` and `write_file` with
public `defineWorkflowTool` executors. The emitted manifest marks these as
`workflow-tool` calls. Eve checkpoints the model's dispatch request before any
workspace mutation. A first workflow step pins the existing scope and generation;
the second performs the operation. A missing workspace fails with initialization
instructions. A deleted generation cannot be reopened by replay.

Each operation restores a private `InMemoryFs`. A libSQL write transaction commits
the complete snapshot, a revision compare-and-swap, and an immutable operation
receipt together. Results are released only after this transaction is confirmed.
The receipt stores the bounded original result and a fingerprint of the actual
command/cwd/environment or file operation. A retry of the same operation returns
that result, even after later independent edits or a lost database response.
A reused identity with a different payload is rejected. Stale independent writers
fail explicitly; they never overwrite newer files.

The operation key hashes the trusted session ID, turn ID, call ID and tool name,
not the command text. Different calls with identical text execute independently.
Provider IDs reused in later turns remain distinct. Each receipt also records a
hash of the public `getWorkflowMetadata().workflowRunId`. Retries within that run
replay the receipt. A different run claiming the same turn/call identity is
**refused as ambiguous**, even for identical text. Inspect the workspace before
issuing a replacement command; this error does not mean the earlier call failed.

This extra run guard is necessary: Eve's installed workflow guide explicitly
allows duplicate runs if dispatch is interrupted after starting a workflow.
Using a run ID alone would publish the same mutation twice. Eve enforces unique
call IDs within a coordination batch, but its public tool context does not expose
the model-step index. A provider reusing a call ID in another batch of the same
turn therefore also fails closed. The candidate does not assume session-wide
provider-ID uniqueness.

The guarantee is at most one **committed filesystem effect and result** for that
call identity, with exact result replay in the owning run. Concurrent attempts
can compute privately more than once; only one snapshot becomes durable. There
is no claim of exactly-once external effects or arbitrary command execution.
If both the commit response and confirmation read are lost, only the same
workflow operation may retry automatically. The model must not blindly issue a
new call to repeat an uncertain effect.

The public provider has no call identity. Its unscoped `run`/`spawn` calls are
read-only: any changed snapshot is discarded and reported as unsupported. Raw
file writes and removals are refused. This closes default-tool and future-tool
bypass routes. `read_file`, `grep`, `glob` and computation without durable changes
remain usable. The only unscoped import exception is Eve's content-addressed
attachment path: it must match the SHA-256 prefix of the bytes, repeated imports
must match existing bytes, and all commands preserve `/workspace/.eve` unchanged.
Attachments can be read or copied elsewhere before editing.

Candidate `write_file` requires `expectedSha256` (from `sha256sum`) or `"missing"`
for a new file. The write fails if existing contents changed. Its replay returns
the original receipt without overwriting later edits. Scoped internal binary
writes and removals share the same receipt protocol; no agent tool exposes an
unscoped mutating fallback.

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

| Surface            | Contract                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent files   | `/workspace`, `/home`, `/tmp`; binary bytes, empty directories, file/directory modes and modification times survive resume.                                                 |
| Links              | Symbolic links within those roots survive. Hard links are rejected. Symbolic-link mode/timestamps are not preserved.                                                        |
| Shell state        | Each command starts a fresh shell in `/workspace` with the explicit base environment. `cd`, `export`, functions and shell options do not survive commands.                  |
| Files              | At most 3 MiB per file, 4 MiB total, 1,024 entries, 1,024 bytes per path. Large attachments fail explicitly; use a native session or a future artifact backend.             |
| Snapshot transport | At most 6 MiB UTF-8 encoded JSON before a database request. The SQL table also constrains stored length.                                                                    |
| Commands           | 64 KiB source and environment, 256 KiB output, 5,000 commands/loop iterations, 10 seconds execution. Additional hardened interpreter limits apply.                          |
| Uploads            | Byte streams are bounded and cancelled on caller abort, shutdown or the 10-second read deadline.                                                                            |
| Receipts           | At most 512 recorded operations and 16 MiB of serialized results per workspace generation. Replays still work at the cap; new operations fail closed.                       |
| Processes          | Unscoped `spawn` supports the stream/wait/kill shape only for commands without durable mutations. Output is buffered. No background processes, ports, packages or browsers. |
| Text I/O           | UTF-8; use binary I/O for other encodings.                                                                                                                                  |

The virtual filesystem enforces file size before writes and appends. Compound
copy/move operations roll back their partial filesystem changes if they fail.
Command exceptions and cancellation before commit discard the whole operation's
private filesystem, including cancellation during asynchronous snapshot capture.
An ordinary nonzero shell exit can still commit legitimate earlier changes,
matching shell semantics. Once the database transaction has started, cancellation
cannot reliably prevent or undo its commit; inspect its receipt or replay the same
operation to determine the result.

`stop` and runtime shutdown close the handle, abort outstanding work, and retain
committed files. `delete` and terminal-session cleanup replace the snapshot with
an empty tombstone and remove that generation's receipts. Cleanup is idempotent
and generation-fenced: an old cleanup cannot erase a newly opened generation.
A cleanup/writer race can cause a stale
CAS failure; Eve retries terminal cleanup, or an explicit delete can be retried.
There is no expiry of active workspaces. Small tombstones are retained indefinitely
to preserve fencing; a retention job requires an authoritative session-retirement
boundary before it may remove them. There is no such cleanup job in this slice.
A crashed or retired session whose terminal cleanup never runs can retain its
full workspace and receipts indefinitely. These are bounds per workspace, not a cap on total
database growth; operator reconciliation and global quotas remain release work.

## Release gates

1. Apply additive migrations `0001_agent_workspaces.sql` and
   `0002_workspace_operations.sql` through the normal reviewed database path.
   Migration 0002 adds a receipt table and bounded counters without rebuilding or
   modifying saved workspace bytes. No live migration was run for this change.
   Missing tables or credentials fail closed; there is no local-disk or Redis
   fallback.
2. Keep both the old Eve deployment and native sandbox sessions on their existing
   routing until the runtime migration is proven. Eve 0.81.1
   `execution/sandbox/ensure.js` checks saved `providerName` and
   `stateProtocolVersion` before calling `resume`; a mismatch throws. The selector
   is skipped for saved state. Changing this flag on a deployment with existing
   sessions therefore **blocks their sandbox access**, rather than converting or
   transparently rolling them back. Treat the flag as deployment configuration,
   with the same value at build and runtime. V2 uses provider/state protocol 2 and
   a new scope namespace. Route new sessions to a `durable-bash-v2` execution
   identity; retain native and v1 destinations for their existing sessions.
   Never relabel an existing destination or convert v1 state in place.
3. Compatible redeploys of this provider keep existing files. New seeds initialize
   only a new generation; current build artifacts never overwrite saved bytes.
4. Validate the actual deployed workflow boundary, including a crash after
   mutation commit but before checkpoint, duplicate dispatch runs, reused provider
   IDs, steering/cancellation, attachments and generation retirement. Local
   regression checks cover the storage protocol, installed dispatcher and compiled
   workflow body; they do not constitute a live Workflow crash/recovery test.
   Preserve the explicit ambiguity error for duplicate runs and reused IDs.
5. Re-run the isolated bundle check below on the Linux deployment artifact, then
   run fresh-host/session, interruption, attachment and cleanup checks in an
   isolated candidate deployment. Local Node/Bun checks do not prove the Vercel
   runtime or network round-trip performance.
6. Measure actual task latency, database traffic and cost with representative
   payloads. Snapshot writes trade bounded database I/O for VM setup. This change
   does not establish a p95 latency improvement. Turso transport limits and regional
   latency still need candidate-deployment verification. The first command may add
   one `workspace_open` model call, and each candidate mutation uses two Workflow
   steps. These durability costs must be measured alongside VM setup savings.

Native escalation is not automatic. A task needing browsers, native builds,
packages, larger files or background work must use an operator-routed native
session. Never stop, delete, migrate or reset existing production resources as a
side effect of selecting this candidate.

## Local verification

The `durable-bash`, `durable-bash-replay` and `sandbox-workflow` Bun tests use local
libSQL databases, including separate Bun processes with empty environments and no
shared filesystem cache. They cover seeds, binary/mode/link preservation, isolation,
generation fencing, concurrent CAS, atomic receipt rollback, unavailable commit
confirmation, replay after later writers, duplicate run refusal, reused IDs across
turns, unchanged native tool selection, unsupported mutation refusal, immutable
attachment import, cleanup, cancellation, output bounds, Python and QuickJS.
The repository lint, formatting, capability and serialization checks also apply.

Installed framework evidence (Eve 0.81.1): `docs/tools/workflows.mdx` documents
workflow dispatch/retry semantics and public contexts;
`harness/execute-call.js` returns a dispatch marker without executing a workflow
tool during the model step; `harness/step/after-model.js` and
`execution/coordination-dispatch-step.js` separate the checkpointed request from
dispatch. `execution/tools/workflow/start.js` forwards the recorded turn/call
coordinates into each run. Tests import these installed internals only as
regression probes; production code uses public APIs and adds no framework patch.

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
`just-bash` import, checks the compiled workflow tool entries on all thirteen
agents, and executes both emitted workflow bodies against a local database with
a simulated lost mutation-step checkpoint. It runs Python date/JSON and QuickJS
BigInt computations with an empty environment and enforces a 200 MiB candidate
server-artifact budget. These are artifact and local protocol checks, not a
deployed HTTP/session test;
Linux native dependencies, platform limits and the full session lifecycle still
need the candidate-deployment checks above. Build and runtime must use the same
provider flag. The unchanged native/default build path may require its normal
provider setup or `--skip-sandbox-prewarm` for local validation.
