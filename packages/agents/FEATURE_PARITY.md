# Agent feature-parity accounting

`feature-parity.json` is the reviewed capability-surface snapshot. It is derived from
the library-native authored sources, not from totals copied out of the migration plan:

- `agent/subagents/*/skills/catalog.ts` supplies native skill policy, content, and historical tool membership.
- `agent/subagents/*/lib/tool-registry.ts` supplies the independently resolved domain tools.
- `agent/subagents/*/agent.ts` supplies the declared subagent set.

`bun run check:parity` fails when the catalogs reference unknown or duplicate tools, a
registry tool is absent from both the base set and every skill, required subagent files are
absent, or the reviewed snapshot changes. For an intentional capability change, inspect the
diff and run `bun run parity:update`. The agents package runs the check from `typecheck`,
`test`, `build`, and `info`, so the repository CI exercises it.

Tool discovery is filtered by current role and the existing descriptor policy, independently
of skill loading. Provider configuration is deliberately not a discovery condition: some
readiness is input-dependent, and missing credentials remain the existing typed
execution-time failure rather than silently hiding a capability.

`bun run test:skills:lifecycle` builds a temporary Eve app from the actual rendered Linear
`issues` definition. It verifies compiled catalog discovery, default sandbox provisioning,
two native loads on one preserved session, and package removal after an empty resolver
result. The fixture is always removed, including on failure.

## Serialization boundaries

`check:parity` also runs `check:serialization`. Its source invariant requires every authored
Eve `defineTool` executor to return through `guardToolExecution`, and every Eve `defineState`
initializer to return through `assertStateValue`. Runtime validation accepts only plain JSON
values and raises `InvariantViolated` for class instances, `Date`, `Map`, `Set`, `Result`,
cycles, accessors, non-enumerable data, or values JSON would omit or coerce. JSON-looking
strings remain strings; validation never reparses a legitimate tool result.

## Why the plan totals differ

A source inventory of the legacy tree reconciled the headline plan numbers as follows:

| Surface                    | Legacy source inventory | Current native surface | Reconciliation                                                                                                                                                                                                                                       |
| -------------------------- | ----------------------: | ---------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool definitions           |                     679 |       659 domain tools | Legacy was 672 domain + 7 orchestrator definitions, not the plan's 678. The generated API-domain catalogs exclude the code domain's 10 tools and three tools parked behind the compiler-disabled `sales/_outreach-send` skill: `672 - 10 - 3 = 659`. |
| Sub-skills                 |   109 files, 108 active |      104 native skills | Four active skills belonged to the specialized code domain; one `_outreach-send` skill was compiler-disabled. The remaining API-domain sources are `109 - 4 - 1 = 104`.                                                                              |
| Delegate domains/subagents |       12 legacy domains |           13 subagents | The 12 legacy domains include code. The current tree renames `sales` to `outreach` and splits the legacy core `documentation` tool into the additional `docs` subagent.                                                                              |

The plan itself reflects two different moments: its overview says 12 declared subagents,
while its RBAC section says all 13 scaffolded subagents. The source-derived count is 13:
11 native integration domains plus the `code` and `docs` auxiliary subagents.

The historical totals explain the migration baseline; they are deliberately not magic
numbers in the checker. The committed manifest records exact tool and skill names, so a
same-count rename/removal also produces a reviewable CI failure.
