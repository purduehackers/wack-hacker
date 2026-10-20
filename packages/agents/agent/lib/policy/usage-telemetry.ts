import { getRedis } from "@repo/shared/redis";
import type { HookContext, HookEventMap } from "eve/hooks";

import { env } from "../../env.ts";
import { countAgentEvent, distributeAgentEvent, turnTokenKey } from "../telemetry.ts";

const redis = getRedis({
  url: env.REDIS_URL,
});
const TURN_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const ADD_TURN_TOKENS_SCRIPT = `
if redis.call("SADD", KEYS[2], ARGV[3]) == 0 then return redis.call("GET", KEYS[1]) end
local value = redis.call("INCRBY", KEYS[1], ARGV[1])
redis.call("EXPIRE", KEYS[1], ARGV[2])
redis.call("EXPIRE", KEYS[2], ARGV[2])
return value
`;

function countTokens(direction: string, value: number | undefined, delegate?: string): void {
  if (value === undefined || value <= 0) return;
  countAgentEvent(
    "agent.tokens",
    { direction, ...(delegate === undefined ? {} : { delegate }) },
    value,
  );
}

async function persistTurnTokens(
  sessionId: string,
  turnId: string,
  eventId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  const tokenKey = turnTokenKey(sessionId, turnId);
  try {
    await redis.eval(
      ADD_TURN_TOKENS_SCRIPT,
      [tokenKey, `${tokenKey}:events`],
      [tokens, TURN_TOKEN_TTL_SECONDS, eventId],
    );
  } catch {
    countAgentEvent("agent.turn_token_accounting", { status: "unavailable" });
  }
}

/** Every agent reports model usage; durable turn totals deduplicate event IDs. */
export async function recordUsageTelemetry(
  event: HookEventMap["step.completed"],
  ctx: HookContext,
): Promise<void> {
  const usage = event.data.usage;
  if (usage === undefined) return;
  const parent = ctx.session.parent;
  const delegate = parent === undefined ? undefined : ctx.agent.name;
  countTokens("input", usage.inputTokens, delegate);
  countTokens("output", usage.outputTokens, delegate);
  countTokens("cache_read", usage.cacheReadTokens, delegate);
  countTokens("cache_write", usage.cacheWriteTokens, delegate);
  if (usage.costUsd !== undefined && usage.costUsd >= 0) {
    distributeAgentEvent(
      "agent.cost",
      usage.costUsd,
      "none",
      delegate === undefined ? {} : { delegate },
    );
  }
  const visibleTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  await persistTurnTokens(ctx.session.id, event.data.turnId, event.meta.id, visibleTokens);
  if (parent !== undefined) {
    await persistTurnTokens(parent.sessionId, parent.turn.id, event.meta.id, visibleTokens);
  }
}
