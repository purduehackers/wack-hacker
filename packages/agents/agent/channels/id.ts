/**
 * Purdue Hackers ID → Discord role sync.
 *
 * ID is where organizer and admin status is decided; this route makes Discord
 * follow. It lives on the agent rather than the bot because a webhook needs a
 * stable public URL, and the bot's Sandbox address changes with every
 * generation the supervisor starts.
 *
 * The ID application behind this endpoint needs directory access with
 * `directory:roles` and `directory:discord`: the first makes ID deliver every
 * user's events without per-user consent, the second puts the linked Discord
 * account in the payload. Subscribe it to `user.roles.changed` and
 * `user.discord.unlinked`.
 *
 * Status codes are chosen for ID's retry loop. A 2xx is final, including for
 * events that need nothing done; a 5xx asks ID to try again with backoff, which
 * is what a Discord outage or rate limit should get. A bad signature is a 401
 * so it shows in ID's delivery log as a configuration problem.
 */

import { getRedis } from "@repo/shared/redis";
import * as Sentry from "@sentry/node";
import { defineChannel, POST } from "eve/channels";

import { env } from "../env.ts";
import { syncDiscordRoles, type SyncOutcome } from "../lib/id/role-sync.ts";
import { decodeIdWebhook, verifySignature, type IdWebhook } from "../lib/id/webhook.ts";
import { discordRest } from "../subagents/discord/lib/client.ts";

const ID_WEBHOOK_ROUTE = "/id/webhook";

const redis = getRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

async function apply(event: IdWebhook): Promise<SyncOutcome> {
  const discordId = event.data.user.discord_id;
  if (discordId === null) return { status: "no-discord" };
  return syncDiscordRoles(
    { rest: discordRest(), redis },
    {
      discordId,
      // An unlinked account no longer belongs to anyone in ID, so it keeps none
      // of the roles ID grants.
      idRoles: event.type === "user.roles.changed" ? event.data.roles : [],
      occurredAt: new Date(event.timestamp),
    },
  );
}

export default defineChannel({
  routes: [
    POST(ID_WEBHOOK_ROUTE, async (request) => {
      const secret = env.ID_WEBHOOK_SECRET;
      if (secret === undefined || env.DISCORD_BOT_TOKEN === undefined) {
        return Response.json(
          { ok: false, message: "role sync is not configured" },
          { status: 503 },
        );
      }

      const body = await request.text();
      const signed = verifySignature(
        secret,
        {
          id: request.headers.get("webhook-id") ?? undefined,
          timestamp: request.headers.get("webhook-timestamp") ?? undefined,
          signature: request.headers.get("webhook-signature") ?? undefined,
          body,
        },
        Date.now(),
      );
      if (!signed) return Response.json({ ok: false, message: "bad signature" }, { status: 401 });

      const decoded = decodeIdWebhook(body);
      if (decoded.kind === "invalid") {
        return Response.json({ ok: false, issues: decoded.issues }, { status: 400 });
      }
      if (decoded.kind === "ignored") return Response.json({ ok: true, ignored: decoded.type });

      const { event } = decoded;
      try {
        const outcome = await apply(event);
        console.info(
          JSON.stringify({
            event: "id.role-sync",
            type: event.type,
            sub: event.data.user.sub,
            discordId: event.data.user.discord_id,
            ...outcome,
          }),
        );
        return Response.json({ ok: true, status: outcome.status });
      } catch (cause) {
        Sentry.captureException(cause, { tags: { op: "id.role-sync", type: event.type } });
        console.error("id role sync failed", cause);
        return Response.json({ ok: false, message: "role sync failed" }, { status: 502 });
      }
    }),
  ],
});
