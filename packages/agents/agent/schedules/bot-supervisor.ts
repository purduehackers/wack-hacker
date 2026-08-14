/**
 * Five-minute reconcile for the bot's Vercel Sandbox.
 *
 * The bot is one always-on container because it owns a Discord gateway, and
 * Vercel Sandbox caps a container at 24 hours. This schedule is what replaces
 * it before that deadline. Each replacement:
 *
 * - holds a Redis fencing lock
 * - starts a digest-pinned candidate
 * - waits for the candidate's own `/health` to report a connected gateway
 * - publishes the new generation atomically
 * - drains the previous one
 * - sweeps orphans it can prove are its own
 *
 * It lives here rather than in its own deployment because Eve already owns a
 * durable cron surface. Also, this app is already the *reader* of the
 * generation record it writes (`lib/bot/endpoint.ts`). One deployment now owns
 * both sides of that record.
 *
 * The tick is deliberately quiet on the happy path: a healthy sandbox with
 * time left logs one line and does nothing else. Reconciliation is idempotent
 * and fenced, so a missed tick costs at most five minutes and a concurrent one
 * loses the Redis mutex race harmlessly.
 *
 * Two other Sandbox surfaces exist in this app: Eve's own code-subagent
 * sandboxes and the Vercel provider tools that inspect team sandboxes. This
 * schedule is neither. It manages exactly one workload, identified by its
 * tags.
 */

import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import { defineSchedule } from "eve/schedules";

import { env } from "../env.ts";
import { botSupervisionConfig } from "../lib/bot/supervisor-config.ts";
import { createBotSandboxSupervisor } from "../lib/bot/supervisor.ts";
import { countAgentEvent, logAgentEvent } from "../lib/telemetry.ts";

const redis = getRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

async function reconcileBotSandbox(): Promise<void> {
  if (!env.BOT_SANDBOX_ENABLED) return;

  // The tick assembles configuration each time rather than at module scope,
  // so a missing bot credential fails this schedule alone. Reasoning, tools,
  // and the channel routes must keep serving a deployment whose supervision
  // config is wrong.
  const result = await Result.tryPromise({
    try: async () => {
      const config = botSupervisionConfig(env);
      const supervisor = createBotSandboxSupervisor({ redis, ...config });
      return await supervisor.ensure();
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

  if (Result.isError(result)) {
    countAgentEvent("agent.bot_sandbox.ensure", { status: "failed" });
    logAgentEvent(
      "bot.sandbox.ensure",
      { status: "failed", error: result.error.name, message: result.error.message },
      "error",
    );
    return;
  }

  const outcome = result.value;
  if (Result.isError(outcome)) {
    countAgentEvent("agent.bot_sandbox.ensure", { status: "failed" });
    logAgentEvent(
      "bot.sandbox.ensure",
      { status: "failed", error: outcome.error._tag, message: outcome.error.message },
      "error",
    );
    return;
  }

  const { status, active } = outcome.value;
  countAgentEvent("agent.bot_sandbox.ensure", { status });
  logAgentEvent("bot.sandbox.ensure", {
    status,
    sandboxName: active.sandboxName,
    generation: active.generation,
    image: active.image,
    expiresAt: active.expiresAt,
  });
}

export default defineSchedule({
  cron: "*/5 * * * *",
  run({ waitUntil }) {
    waitUntil(reconcileBotSandbox());
  },
});
