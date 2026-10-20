# Provider capability baseline

The product refactor starts from **12 provider domains, 670 tool definitions, and
106 skills** at `8e14f97`. These are authored capabilities. Configuration, provider
permissions, and successful end-to-end behavior remain **unverified** by this
inventory. No provider API requests are made by the checks below.

| Domain     | Tools | Skills |
| ---------- | ----: | -----: |
| Cloudflare |    29 |      5 |
| CMS        |    54 |      6 |
| Discord    |    68 |     14 |
| Figma      |    33 |      7 |
| Finance    |    16 |      6 |
| GitHub     |   119 |     16 |
| Linear     |    64 |     16 |
| Notion     |    24 |      4 |
| Outreach   |    23 |      5 |
| Sentry     |    68 |     15 |
| Shopping   |     6 |      1 |
| Vercel     |   166 |     11 |

## Reproduce the inventory

From the repository root:

```sh
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents check:capabilities
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents report:capabilities
SKIP_ENV_VALIDATION=1 bun run --cwd packages/agents report:capabilities --json > /tmp/wack-capabilities.json
bun test packages/agents/scripts/tests/capability-baseline.test.ts packages/agents/scripts/tests/capability-report.test.ts
```

`check:capabilities` and `report:capabilities` share registry imports and the same
layout, skill coverage, and README checks. They do not scrape TypeScript to guess
the tool list. The checker also validates the frozen
[migration baseline](../../packages/agents/capabilities/migration-baseline.json).
Existing CI already runs this checker and `bun test`, so both the migration
contract and regression cases gate changes.

The text report lists all collisions and their namespaced replacements. The JSON
report includes every tool and skill, repository-relative source paths, skill
membership, base discovery, descriptions, risk, declared credential key names, and
role metadata. It omits schemas, credential values, generated timestamps, and
machine-specific paths. Two fresh processes produce the same report for the same
source tree.

All reported implementation evidence is static: the registry imports, each
executor is callable, every definition has exactly one source file, and every tool
is reachable from its domain's base list or skills. Import success does not prove
that an executor will work with a real provider. `declaredRequirements: []` means
the tool has no `requires` declaration; a runtime configuration hook or provider
client may still require credentials.

## Stable identities and migration parity

Use `domain__operation` for tools and `domain__skill` for skills. The separator is
reserved within each segment, so two distinct domain/name pairs cannot encode the
same identity. Names must fit the framework's 64-character limit and cannot use its
reserved `eve__` prefix. Tools and skills have separate namespaces. The initial surface has
**41 ambiguous bare tool names** and **10 ambiguous bare skill names**; for example,
`cms__create_event` and `discord__create_event` must remain distinguishable.

The baseline pins each domain's base tool identities and each skill's tool
membership. Their union records all 670 original tools. It deliberately omits
descriptions, schemas, and role copies that would go stale whenever policy changes.
The checker permits additions while rejecting removed domains, tools, skills,
base discovery paths, or existing skill-to-tool mappings. Renaming or reorganizing
a capability requires an explicit compatibility decision and review of the
baseline diff; do not regenerate the baseline merely to make a migration pass.

The report describes authored registries, not the framework's resolved model
catalog. Later catalog work must compare the actual resolved catalog against these
identities and exercise role changes, discovery, execution, and resume behavior.
Framework-default tools and root-only tools are outside this provider baseline and
need their own policy/release coverage.

## Access metadata is not authorization

The report imports each domain's runtime to obtain its current admission and tool
descriptors. It does not reimplement the tool-role default. The fields distinguish:

- `entryRole`: the domain admission descriptor. All twelve are `organizer` at the
  baseline commit.
- `declaredRole`: the explicit role on a tool or skill; `runtime-default` means a
  tool leaves that decision to its descriptor.
- `toolRole`: the tool descriptor's resolved role. A read tool may say `public`
  even though domain admission requires `organizer`.
- `admittedRole`: the stricter role across domain admission and the tool or skill.
  Each tool's skill routes also include that skill's role.

Skill roles govern availability of skill instructions; loading a skill does not
grant execution authority. Current provider catalogs expose their permitted tools
independently of which skill was loaded. Budget, current actor, contextual scope,
approval, and provider access are still evaluated at runtime. A
`confirmation: runtime-default` value does not mean confirmation is unnecessary.

The main-agent migration must preserve domain admission as well as per-operation
checks. Merely copying a tool's `public` read default onto the root agent would
broaden access relative to the existing provider-subagent path.

## Evidence still required

This is the first baseline slice of the
[product refactor](../plans/wack-hacker-product-refactor.md). It does not establish
provider API completeness, live readiness, output quality, latency, or Discord UX.
Those require the coverage ledger, controlled integration checks, task evaluations,
and rendered client verification in the plan. No synthetic success percentage or
unrun provider test is represented as validation here.
