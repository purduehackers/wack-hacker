# Environment variables

`src/env.ts` validates env at startup using `@t3-oss/env-core` and Zod. Missing or invalid vars throw immediately — the function won't boot.

## Current groupings

The full list changes often; the canonical source is always [`src/env.ts`](../../src/env.ts). Today it covers:

- **Discord** — `DISCORD_BOT_TOKEN`, `DISCORD_BOT_CLIENT_ID`, `DISCORD_BOT_PUBLIC_KEY`. The guild ID is a hard-coded constant in `src/lib/constants.ts`, not an env var.
- **Cron auth** — `CRON_SECRET` (bearer token for `/api/crons/*`).
- **AI** — `GROQ_API_KEY` (used by one specialized tool). The AI SDK Gateway authenticates via the standard `VERCEL_*` OIDC vars loaded by the `vercel()` preset.
- **Integrations — engineering** — Linear (`LINEAR_API_KEY`), Notion (`NOTION_TOKEN`), GitHub App (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_ORG`), Figma (`FIGMA_ACCESS_TOKEN`, `FIGMA_TEAM_ID`), Sentry (`SENTRY_AUTH_TOKEN`, `SENTRY_ORG`).
- **Integrations — ops & platform** — Vercel (`VERCEL_API_TOKEN`, `VERCEL_EDGE_CONFIG_ID`, `EDGE_CONFIG`), Hack Club Bank (`HCB_ORG_SLUG`), SerpAPI for `delegate_shopping` (`SERPAPI_API_KEY`).
- **Integrations — sales & CMS** — Resend (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`), Hunter.io (`HUNTER_API_KEY`), Payload CMS (`PAYLOAD_CMS_API_KEY`), ask.purduehackers.com (`PHACK_ASK_API_KEY`), Phack API (`PHACK_API_TOKEN`).
- **Storage** — Upstash Redis (`KV_REST_API_URL`, `KV_REST_API_TOKEN`), Turso main (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`), Turso ship (`SHIP_DATABASE_TURSO_DATABASE_URL`, `SHIP_DATABASE_TURSO_AUTH_TOKEN`), Cloudflare R2 (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `SHIP_R2_BUCKET_NAME`), privacy DB (`PRIVACY_DB_API_KEY`).
- **Optional** — `SENTRY_DSN` (client-side error reporting), `SANDBOX_BASE_SNAPSHOT_ID` (preseeded Vercel Sandbox snapshot with `ripgrep` + `gh`; speeds up `delegate_code` cold starts by ~20-30s — create one via `scripts/create-sandbox-snapshot.ts`).

## Adding a new env var

1. Add the Zod field to the `server` object in `src/env.ts`. Use `z.string()` unless you have a reason to be stricter.
2. Use `env.YOUR_VAR` from anywhere in `src/` — the import is `import { env } from "@/env"`.
3. Add the value to your Vercel project's environment variables (via the dashboard or `vercel env add`).
4. Pull it locally: `bunx vercel env pull --yes`.

If you forget step 3, every deploy will fail at boot with a Zod error. Every Vercel environment (development, preview, production) needs the value.

## Pulling env locally

```bash
bunx vercel env pull --yes
```

This writes `.env.local`. The Next.js dev server picks it up automatically.

`.env.local` is gitignored. Don't commit it.

## Presets

`src/env.ts` extends `[vercel()]`, which auto-declares the standard `VERCEL_*` deployment vars so you don't have to list them manually. Add other presets (`upstashRedis()`, etc.) to the `extends` array if you pick up a new platform integration.
