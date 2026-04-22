# Environment variables

`src/env.ts` validates env at startup using `@t3-oss/env-core` and Zod. Missing or invalid vars throw immediately — the function won't boot.

## Current groupings

The full list changes often; the canonical source is always [`src/env.ts`](../../src/env.ts). Today it covers:

- **Discord** — bot token, client ID, public key, guild ID.
- **Cron auth** — `CRON_SECRET` (bearer token for `/api/crons/*`).
- **Integrations** — Linear, Notion, GitHub App credentials (org-installed), Groq, ask.purduehackers.com API key, dashboard URL, Phonebell open URL.
- **Storage** — Upstash Redis (KV REST), Cloudflare R2 (account ID + access keys + ship bucket), Payload CMS (API key for hack-night media + curated content), Turso libSQL (privacy DB and ship DB).
- **Vercel** — API token, Edge Config ID. The `vercel()` preset auto-loads `VERCEL_*` deployment vars.
- **Optional** — Sentry DSN.

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
