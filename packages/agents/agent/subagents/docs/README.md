# `docs`

Looks up Purdue Hackers documentation. The smallest subagent in the tree: one
real tool and a three-line prompt.

Like `code`, it is **auxiliary** — no client, no registry, no skill catalog, no
`lib/`. Unlike every provider domain, its visibility is decided by
`lib/core/runtime.ts`'s `isCoreToolVisible` rather than by a domain runtime, so
it has no `subagentDescriptor` and no per-tool policy of its own.

## Tools

| Tool            | What it is                                                                       |
| --------------- | -------------------------------------------------------------------------------- |
| `documentation` | fetches and returns a documentation page                                         |
| `sleep`         | a two-line re-export of Eve's own `sleep`, kept so the subagent can pace polling |

## Notes

`instructions.md` is three lines, and that is deliberate — the tool's own
description carries the behaviour, so there is nothing for a prompt to add.

Its audit hook is hand-rolled rather than `defineDomainAuditHook`, which is the
only reason this subagent has a `hooks/` directory at all.
