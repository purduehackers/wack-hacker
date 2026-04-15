# Adding skills and domains

Two common paths: extending an existing domain with a new sub-skill, or standing up a whole new delegate domain.

## Adding a sub-skill to an existing domain

1. **Add the tool**. Create or extend a tool file under `src/lib/ai/tools/<domain>/<group>.ts`. Export an AI SDK `tool({ description, inputSchema, execute })`. Add it to the domain's barrel `index.ts`.
2. **Create the sub-skill**. Make `src/lib/ai/skills/<domain>/skills/<sub-skill>/SKILL.md`. In the frontmatter, list your new tool name in the `tools` array. Pick the right `minRole` (usually `organizer`).
3. **Admin?** If the new tool is destructive or admin-only, wrap its definition in `admin(...)` — see [Admin gating](./admin.md).
4. **Recompile**. Run `bun scripts/compile-skills.ts` (or just `bun run build`).

That's it — the new sub-skill will appear in the subagent's `{{SKILL_MENU}}` automatically, and `loadSkill("<sub-skill>")` will unlock the new tool when called.

## Adding a new delegate domain

1. **Create the top-level skill**. Make `src/lib/ai/skills/<name>/SKILL.md` with `mode: delegate`. Include `{{SKILL_MENU}}` somewhere in the body where the sub-skill menu should be injected.
2. **Add tool files** under `src/lib/ai/tools/<name>/`, exporting them from a barrel `index.ts`.
3. **Create at least one sub-skill**: `src/lib/ai/skills/<name>/skills/<sub>/SKILL.md` listing the tool names it unlocks. A domain with zero sub-skills can still work, but the subagent will only ever see its `baseToolNames` — likely not useful.
4. **Register the domain** in the `DOMAINS` map inside `src/lib/ai/delegates.ts`. You'll need to provide:
   - `tools: ToolSet` — the full domain tool set (usually `... as unknown as ToolSet`, since the barrel gives you a typed namespace).
   - `subSkills: SKILL_MANIFEST` — the per-domain sub-skill manifest, imported from `./skills/generated/domains/<name>.ts`.
   - `baseToolNames: readonly string[]` — the always-visible discovery tools (typically 3–4 search/retrieve tools).
5. **Run** `bun scripts/compile-skills.ts` to regenerate the manifests (the build does this automatically).
6. **Update the orchestrator's system prompt** in `src/lib/ai/orchestrator.ts` to mention `delegate_<name>` alongside the existing delegates, so the model learns when to use it.

The new `delegate_<name>` tool will appear in the orchestrator's tool list for any user whose role meets the top-level skill's `minRole`.

## Testing

- Unit-test the tool implementation under `src/lib/ai/tools/<domain>/<tool>.test.ts`. Tools are excluded from coverage thresholds, but a unit test is still the cheapest way to catch regressions.
- If the new domain introduces a new integration (auth, HTTP client, etc.), put that in `src/bot/integrations/` and test it there.
