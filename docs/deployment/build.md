# Build pipeline

```
bun run build
  ├── bun scripts/compile-skills.ts    → src/lib/ai/skills/generated/
  ├── next build                        → .next/ + .vercel/output
  └── bun scripts/register-commands.ts  → registers slash commands with Discord
```

## Why the order matters

**`compile-skills.ts` must run before `next build`** because the generated manifests under `src/lib/ai/skills/generated/` are imported by the agent code (`delegates.ts`, `subagent.ts`). If they're stale or missing, `next build` will either use outdated skill definitions or fail to type-check.

**`register-commands.ts` runs after `next build`** because it talks to Discord, and we only want it to succeed if the build succeeded. If you've broken something in your command handlers, the build will catch it before we touch the live bot.

## compile-skills.ts

Walks `src/lib/ai/skills/*/SKILL.md` and `src/lib/ai/skills/*/skills/*/SKILL.md`, parses the YAML frontmatter and markdown body, and emits TypeScript modules:

- `src/lib/ai/skills/generated/manifest.ts` — the top-level manifest of delegate-mode skills.
- `src/lib/ai/skills/generated/domains/<domain>.ts` — one per domain, containing its sub-skill manifest.

The output is committed to the repo. Type-checking and tests rely on having the files present, so running `bun run validate` on a clean checkout works without a build step.

## register-commands.ts

Requires Discord credentials (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID`) at build time:

- In CI, those come from Vercel project env.
- Locally, they come from `.env.local`.

The script collects every exported `SlashCommand` from `src/bot/handlers/commands/` and PUTs the full command list to Discord's guild commands endpoint. Running it is idempotent — unchanged commands are accepted as-is.

If you change a command's signature without bumping a build, Discord won't know, and the next interaction will use the stale schema. Always rebuild after touching a slash command builder.

## Standalone dev

`bun dev` does **not** run `compile-skills.ts` automatically. If you edit a `SKILL.md` during development, run `bun scripts/compile-skills.ts` manually (or just `bun run build` to do everything at once).

`next dev` will pick up the new generated files on the next reload.
