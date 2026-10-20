/** Accounting for Eve work not covered by the bot's operation reporter. */

import { getRedis } from "@repo/shared/redis";
import { defineHook } from "eve/hooks";

import { env } from "../env.ts";
import {
  countAgentEvent,
  distributeAgentEvent,
  logAgentEvent,
  turnTokenKey,
} from "../lib/telemetry.ts";

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

export default defineHook({
  events: {
    async "step.completed"(event, ctx) {
      const usage = event.data.usage;
      if (usage === undefined) return;
      countTokens("input", usage.inputTokens);
      countTokens("output", usage.outputTokens);
      countTokens("cache_read", usage.cacheReadTokens);
      countTokens("cache_write", usage.cacheWriteTokens);
      if (usage.costUsd !== undefined && usage.costUsd >= 0) {
        distributeAgentEvent("agent.cost", usage.costUsd, "none", {});
      }

      const visibleTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      await persistTurnTokens(ctx.session.id, event.data.turnId, event.meta.id, visibleTokens);
    },
    "task.started"(event) {
      if (event.data.kind !== "agent") return;
      const attributes = { delegate: event.data.name, status: "called" };
      countAgentEvent("agent.delegation", attributes);
      logAgentEvent("agent.delegation", attributes);
    },
    "task.settled"(event) {
      if (event.data.kind !== "agent") return;
      const attributes = { delegate: event.data.name ?? "agent", status: event.data.status };
      countAgentEvent("agent.delegation", attributes);
      logAgentEvent("agent.delegation", attributes);
    },
    "turn.completed"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "completed", agent: ctx.agent.name });
    },
    "turn.failed"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "failed", agent: ctx.agent.name });
    },
    "turn.cancelled"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "cancelled", agent: ctx.agent.name });
    },
  },
});
