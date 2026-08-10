# `notion` — notes for adding a tool here

Written for whoever extends this domain, not for the agent that runs it. Runtime
guidance belongs in `instructions.md` and `lib/skill_defs/*.md`; this is what the
upstream API does and where it will surprise you.

## Upstream

`@notionhq/client` v5 with `NOTION_TOKEN`. v5 puts a _data source_ between a
database and its rows: `resolveDataSourceId(databaseId)` in `lib/client.ts` is
how you get from one to the other, and query tools take the data source id.

`lib/notion-input.ts` builds the property-value shapes. It is currently forked
with `outreach`'s copy and should be deduplicated rather than extended twice.

## Shape of the API

**`update_database` deletes a property when its value is set to `null`**, taking
every value in that column on every row with it. Notion's trash holds archived
pages and databases; it does not hold a deleted property. This is the one
genuinely unrecoverable operation in the domain.

Everything else destructive is soft: `archive_page`, `archive_database` and
`delete_block` set the trash flag and a human can restore them. The tools say
"delete" because users do.

`update_block` replaces a block's content rather than merging, and
`update_page_content` in `replace_content` mode does the same to a whole page.
Read current state first.

## Adding a tool

New tools go in `lib/tool_defs/<bundle>/<tool>.ts`, one per file, where
`<bundle>` is the name of the skill that lists it (or `base`). Register it in
`lib/registry.ts` under `NOTION_TOOLS` and add its name to the skill's `tools`
array — `check:capabilities` fails if a tool is unreachable from every skill and
the base set, or if a skill names a tool that does not exist. Then run
`bun run --filter @repo/agents readmes`; the README's tables are generated and
CI fails when they are stale.
