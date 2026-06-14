import * as Sentry from "@sentry/nextjs";
import { Redis } from "@upstash/redis";
import { waitUntil } from "@vercel/functions";
import { getVercelOidcTokenSync } from "@vercel/functions/oidc";
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from "discord.js";
import { log } from "evlog";
import { Hono } from "hono";
import { once } from "node:events";
import { monotonicFactory } from "ulid";

import type { Packet } from "@/lib/protocol/types";

import { env } from "@/env";
import { createWideLogger } from "@/lib/logging/wide";
import { countMetric, recordDuration } from "@/lib/metrics";
import { captureTraceparent, withDetachedRootSpan } from "@/lib/otel/tracing";
import { bindGatewayEvents } from "@/lib/protocol/events";
import { PacketCodec } from "@/lib/protocol/packets";
import { send } from "@/lib/tasks/queue/client";
import { DISCORD_EVENT_TOPIC } from "@/lib/tasks/queue/constants";

import { HANDOFF_WAIT_MS, READY_TIMEOUT_MS } from "./constants";

const HOLD_MS = 10 * 60 * 1000;
const LEADER_KEY = "gateway:leader";
const LEASE_TTL_MS = 15_000;
const POLL_INTERVAL_MS = 5_000;

// Atomic compare-and-delete: only removes the lease if we still own it.
// Without this, a get-then-del race could delete a new leader's key after
// we read our own ID but before the del reached Redis.
const RELEASE_LEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

const ulid = monotonicFactory();

/**
 * Capture a gateway-internal failure as a Sentry issue (logger.error →
 * captureException) plus a structured wide event. Previously these were bare
 * `log.error` calls — Sentry logs, not issues — so failures at the bot's only
 * ingestion point were invisible in Issues.
 */
function reportGatewayError(op: string, err: unknown, context: Record<string, unknown> = {}): void {
  const logger = createWideLogger({ op, ...context });
  logger.error(err as Error);
  logger.emit({ outcome: "error" });
}

async function relay(packet: Packet, oidcToken: string): Promise<void> {
  // Detached root: the discord.js client is held across the ~10-minute gateway
  // hold, so its callbacks would otherwise nest every relayed packet under the
  // one stale `/gateway` request trace. A fresh root per packet is what the
  // captured traceparent then carries forward to the consumer.
  return withDetachedRootSpan("gateway.relay", { "packet.type": packet.type }, async () => {
    const logger = createWideLogger({
      op: "gateway.relay",
      event: { type: packet.type },
    });
    const startTime = Date.now();
    try {
      // Serialize this root's context onto the packet so the queue consumer
      // continues the same trace (gateway.relay → discord.event → handlers).
      const traceparent = captureTraceparent();
      await send(DISCORD_EVENT_TOPIC, PacketCodec.encode({ ...packet, traceparent }), {
        oidcToken,
      });
      countMetric("gateway.packet.relayed", { type: packet.type });
      logger.emit({ outcome: "ok", duration_ms: Date.now() - startTime });
    } catch (err) {
      countMetric("gateway.packet.relay_failed", { type: packet.type });
      logger.error(err as Error);
      logger.emit({ outcome: "error", duration_ms: Date.now() - startTime });
    }
  });
}

type Publish = (packet: Packet) => Promise<void>;

async function releaseLease(redis: Redis, listenerId: string): Promise<void> {
  try {
    const released = await redis.eval<[string], number>(
      RELEASE_LEASE_SCRIPT,
      [LEADER_KEY],
      [listenerId],
    );
    if (released === 1) {
      countMetric("gateway.lease.released");
      log.info("gateway", `released lease for ${listenerId}`);
    }
  } catch (err) {
    countMetric("gateway.lease.release_failed");
    reportGatewayError("gateway.lease_release", err, { listener: { id: listenerId } });
  }
}

async function destroyClient(client: Client, listenerId: string): Promise<void> {
  log.info("gateway", `destroying client ${listenerId}`);
  try {
    await client.destroy();
  } catch (err) {
    reportGatewayError("gateway.client_destroy", err, { listener: { id: listenerId } });
  }
}

// Acquires the leader lease and logs the client in. Resolves once Discord
// emits ClientReady; returns a `hold` promise that runs the 10-minute lease
// renewal loop and tears everything down when it completes or loses leadership.
// Throws (and cleans up) if login or the ready handshake fails.
async function startGatewayListener(client: Client): Promise<{ hold: Promise<void> }> {
  const redis = Redis.fromEnv();
  const listenerId = `gw_${ulid()}`;
  const abort = new AbortController();
  const logger = createWideLogger({
    op: "gateway.listener",
    gateway: { listener_id: listenerId },
  });

  countMetric("gateway.listener.started");
  logger.info("listener starting");

  const existing = await redis.get<string>(LEADER_KEY).catch(() => null);
  await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });

  if (existing && existing !== listenerId) {
    logger.info("prior leader detected, waiting for handoff", {
      prior_leader: existing,
      handoff_wait_ms: HANDOFF_WAIT_MS,
    });
    await new Promise((r) => setTimeout(r, HANDOFF_WAIT_MS));
  }

  const poll = setInterval(async () => {
    if (abort.signal.aborted) return;
    try {
      const current = await redis.get<string>(LEADER_KEY);
      if (current !== listenerId) {
        countMetric("gateway.leader.lost");
        logger.info("leadership lost", { current_leader: current ?? null });
        abort.abort();
        return;
      }
      await redis.set(LEADER_KEY, listenerId, { px: LEASE_TTL_MS });
    } catch (err) {
      countMetric("gateway.lease.poll_failed");
      logger.warn("lease poll failed", { reason: String(err) });
    }
  }, POLL_INTERVAL_MS);

  try {
    // Combine the lease-loss abort with a hard timeout so the route can't
    // hang indefinitely if login resolves but ClientReady never fires.
    // Either signal rejects the once() wait and triggers cleanup below.
    const readySignal = AbortSignal.any([abort.signal, AbortSignal.timeout(READY_TIMEOUT_MS)]);
    const ready = once(client, Events.ClientReady, { signal: readySignal });
    await client.login(env.DISCORD_BOT_TOKEN);
    await ready;
    countMetric("gateway.listener.ready");
    logger.set({ ready: true });
  } catch (err) {
    countMetric("gateway.listener.login_failed");
    logger.error(err as Error);
    logger.emit({ outcome: "login_failed" });
    clearInterval(poll);
    await destroyClient(client, listenerId);
    await releaseLease(redis, listenerId);
    throw err;
  }

  const hold = (async () => {
    const holdStart = Date.now();
    let exitReason: string = "hold_elapsed";
    try {
      // Fast-path: abort fired between ready and hold-executor running.
      // AbortSignal listeners added post-abort never fire, so teardown
      // would otherwise wait out the full HOLD_MS.
      if (abort.signal.aborted) {
        exitReason = "aborted_pre_hold";
        return;
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), HOLD_MS);
        abort.signal.addEventListener(
          "abort",
          () => {
            exitReason = "aborted";
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      recordDuration("gateway.listener.hold_duration", Date.now() - holdStart);
      clearInterval(poll);
      await destroyClient(client, listenerId);
      await releaseLease(redis, listenerId);
      logger.emit({
        outcome: "ok",
        exit_reason: exitReason,
        hold_duration_ms: Date.now() - holdStart,
      });
    }
  })();

  return { hold };
}

const route = new Hono();

route.get("/gateway", async (c) => {
  // Vercel crons attach `Authorization: Bearer ${CRON_SECRET}` on every
  // invocation. Reject anything else: lease acquisition below is an
  // unconditional set, so an unauthenticated GET could steal leadership and
  // black out the gateway for the whole login handoff.
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    createWideLogger({ op: "gateway.route" }).emit({ outcome: "unauthorized" });
    return c.json({ error: "Unauthorized" }, 401);
  }

  let oidcToken: string;
  try {
    oidcToken = getVercelOidcTokenSync();
  } catch (err) {
    reportGatewayError("gateway.oidc_unavailable", err);
    return c.json({ error: "oidc unavailable" }, 500);
  }
  const publish: Publish = (packet) => relay(packet, oidcToken);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
    presence: {
      status: "online",
      activities: [
        {
          name: "something eggz",
          type: ActivityType.Watching,
        },
      ],
    },
  });

  client.on(Events.ClientReady, () => {
    log.info("gateway", `Logged in as ${client.user?.tag}`);
  });

  client.on(Events.Error, (err) => {
    reportGatewayError("gateway.client_error", err);
  });
  client.on(Events.ShardError, (err, shardId) => {
    reportGatewayError("gateway.shard_error", err, { shard: { id: shardId } });
  });
  client.on(Events.ShardDisconnect, (event, shardId) => {
    log.warn("gateway", `shard ${shardId} disconnect code=${event.code} reason=${event.reason}`);
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    log.info("gateway", `shard ${shardId} reconnecting`);
  });
  client.on(Events.ShardResume, (shardId, replayed) => {
    log.info("gateway", `shard ${shardId} resumed, replayed ${replayed}`);
  });
  client.on("raw" as any, (packet: { t?: string | null; op?: number }) => {
    if (packet?.t) log.info("gateway", `raw dispatch t=${packet.t}`);
  });

  bindGatewayEvents(client, publish);

  let hold: Promise<void>;
  try {
    // The bot's single ingestion point: if these check-ins stop, the bot is
    // deaf. The crontab mirrors the keepalive schedule that pings this route in
    // vercel.ts, so a missed check-in means an invocation didn't land.
    ({ hold } = await Sentry.withMonitor("discord-gateway", () => startGatewayListener(client), {
      schedule: { type: "crontab", value: "*/9 * * * *" },
      // The listener holds the lease ~10 min, so allow a longer runtime; a small
      // margin still catches a keepalive invocation that never lands.
      checkinMargin: 2,
      maxRuntime: 15,
      timezone: "Etc/UTC",
    }));
  } catch (err) {
    // Pre-listener failures (Redis lease, client login) were silently swallowed
    // here — capture them so a gateway that never becomes ready is visible.
    reportGatewayError("gateway.startup_failed", err);
    return c.json({ error: "gateway failed to become ready" }, 500);
  }

  waitUntil(hold);
  return c.json({ message: "ok" });
});

export default route;
