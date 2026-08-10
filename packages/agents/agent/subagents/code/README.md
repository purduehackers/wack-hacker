# `code`

The sandboxed code subagent. Runs a delegated engineering task inside a Vercel
Sandbox and reports back once, rather than streaming a conversation.

Structurally unlike the twelve provider domains: no client, no tool registry, no
skill catalog, and no `lib/`. `check-capabilities` classifies it as **auxiliary**
for exactly that reason — a subagent that declares neither a skill catalog nor a
tool registry is allowed to have neither, and it is the shape mismatch, not the
absence, that fails the gate.

## Tools

Two real tools, authored one per file under `tools/` in Eve's native convention:

| Tool          | What it is                                                         |
| ------------- | ------------------------------------------------------------------ |
| `code_task`   | accepts the task and starts the sandbox harness                    |
| `post_finish` | the completion path — the largest single file in the subagent tree |

The other seven files — `bash`, `glob`, `grep`, `read_file`, `web_fetch`,
`web_search`, `write_file` — are three lines each and export `disableTool()`.
They exist to _remove_ framework tools Eve would otherwise offer, because this
subagent reaches the filesystem through its sandbox harness rather than through
the agent's own tools. Deleting one of those files silently re-enables a tool.

## Notes

Its audit hook is hand-rolled rather than `defineDomainAuditHook`, and it hashes
tool input with SHA-256 (`opaqueAuditInput`) instead of recording it: a code task
carries whatever the requester pasted, and the audit log is not the place for it.

The model is `openai/gpt-5.6-luna` at `reasoning: "xhigh"` with explicit limits —
the only subagent not on the shared DeepSeek default, because the work is long
and correctness matters more than latency.
