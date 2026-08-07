/** Stable admission receipts for scheduled occurrences. */

import type { RedisClient } from "../redis/client.ts";
import type { ScheduledFirePayload } from "../wire.ts";
import { scheduledFireReceiptKey } from "./keys.ts";

const CLAIM_TTL_MS = 2 * 60_000;
const RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

const CLAIM_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if raw then
  local current = cjson.decode(raw)
  if current.scheduleId ~= ARGV[1]
    or current.ownerId ~= ARGV[2]
    or current.channelId ~= ARGV[3]
    or current.actionType ~= ARGV[4]
  then
    return -1
  end
  return current.status == "accepted" and 2 or 0
end
redis.call("SET", KEYS[1], ARGV[5], "PX", tonumber(ARGV[6]), "NX")
return 1
`;

const COMPLETE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`;

const RELEASE_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

async function claimOccurrence(
  redis: Pick<RedisClient, "eval">,
  payload: ScheduledFirePayload,
  claimToken: string,
): Promise<"acquired" | "accepted" | "busy"> {
  const forwarding = JSON.stringify({
    status: "forwarding",
    claimToken,
    scheduleId: payload.scheduleId,
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    actionType: payload.actionType,
  });
  const result = Number(
    await redis.eval(
      CLAIM_SCRIPT,
      [scheduledFireReceiptKey(payload.occurrenceId)],
      [
        payload.scheduleId,
        payload.ownerId,
        payload.channelId,
        payload.actionType,
        forwarding,
        CLAIM_TTL_MS,
      ],
    ),
  );
  if (result === 2) return "accepted";
  if (result === 1) return "acquired";
  if (result === 0) return "busy";
  throw new Error("scheduled occurrence identity conflicts with its durable receipt");
}

async function completeOccurrence(
  redis: Pick<RedisClient, "eval">,
  payload: ScheduledFirePayload,
  claimToken: string,
): Promise<boolean> {
  const accepted = JSON.stringify({
    status: "accepted",
    scheduleId: payload.scheduleId,
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    actionType: payload.actionType,
  });
  return (
    Number(
      await redis.eval(
        COMPLETE_SCRIPT,
        [scheduledFireReceiptKey(payload.occurrenceId)],
        [claimToken, accepted, RECEIPT_TTL_SECONDS],
      ),
    ) === 1
  );
}

async function releaseOccurrence(
  redis: Pick<RedisClient, "eval">,
  occurrenceId: string,
  claimToken: string,
): Promise<void> {
  await redis.eval(RELEASE_SCRIPT, [scheduledFireReceiptKey(occurrenceId)], [claimToken]);
}

export function createScheduledFireTransitions(redis: Pick<RedisClient, "eval">) {
  return {
    claim: (payload: ScheduledFirePayload, claimToken: string) =>
      claimOccurrence(redis, payload, claimToken),
    complete: (payload: ScheduledFirePayload, claimToken: string) =>
      completeOccurrence(redis, payload, claimToken),
    release: (occurrenceId: string, claimToken: string) =>
      releaseOccurrence(redis, occurrenceId, claimToken),
  };
}

export type ScheduledFireTransitions = ReturnType<typeof createScheduledFireTransitions>;
