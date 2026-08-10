/**
 * Redis-owned per-conversation inbox and delivery state machine.
 *
 * Lua transitions are idempotent under Upstash's automatic HTTP retries. Active
 * ownership is process-independent, and a delivery epoch is carried through Eve
 * so no stale/replayed turn can advance a newer one.
 */

import { z } from "zod";

import { InvalidInput } from "../errors.ts";
import { jsonText } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";
import { Result } from "../result/index.ts";
import { decodeDeliveryPayload, decodeParkedPayload } from "../wire.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload, RenderTarget } from "../wire.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  continuationKeyFromQueueMember,
  ingressKey,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderOutcomeKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
  seenKey,
} from "./keys.ts";

/** Short claim lease is safe because ingress fences one admission per dispatch. */
const DELIVERY_LEASE_MS = 30_000;
/** Completed Discord-message tombstones are only needed across plausible retries. */
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const ADMISSION_RECOVERY_EVE_TURN_ID = "delivery-admission-recovery";
export const ADMISSION_RECOVERY_TEXT =
  "I couldn't safely finish starting this turn, so I stopped rather than risk running it twice.";
export const ADMISSION_RECOVERY_FOOTER =
  "React ✅ to this message to reset the conversation before retrying, or start a new thread.";

const ENQUEUE_SCRIPT = `
-- wack:enqueue
local added = redis.call("SADD", KEYS[3], ARGV[2])
redis.call("EXPIRE", KEYS[3], tonumber(ARGV[4]))
if added == 0 then return 0 end
local pendingKey = redis.call("GET", KEYS[5]) and KEYS[6] or KEYS[1]
redis.call("RPUSH", pendingKey, ARGV[1])
redis.call("SADD", KEYS[2], ARGV[3])
redis.call("SET", KEYS[4], ARGV[5])
return 1
`;

const CLAIM_SCRIPT = `
-- wack:claim
if redis.call("GET", KEYS[4]) then return nil end
local raw = redis.call("GET", KEYS[2])
if raw then
  local active = cjson.decode(raw)
  if active.phase ~= "claimed" then return nil end
  if active.ownerToken == ARGV[1] then return active.deliveryRaw end
  if tonumber(active.deliveryLeaseUntilMs) > tonumber(ARGV[3]) then return nil end
  active.ownerToken = ARGV[1]
  active.deliveryLeaseUntilMs = tonumber(ARGV[4])
  redis.call("SET", KEYS[2], cjson.encode(active))
  return active.deliveryRaw
end
local deliveryRaw = redis.call("LPOP", KEYS[1])
if not deliveryRaw then
  redis.call("SREM", KEYS[3], ARGV[5])
  return nil
end
local delivery = cjson.decode(deliveryRaw)
redis.call("SET", KEYS[2], cjson.encode({
  phase = "claimed",
  ownerToken = ARGV[1],
  deliveryLeaseUntilMs = tonumber(ARGV[4]),
  messageId = delivery.messageId,
  dispatchId = delivery.dispatchId,
  sessionId = "",
  deliveryRaw = deliveryRaw
}))
return deliveryRaw
`;

const RECOVER_ADMISSION_SCRIPT = `
-- wack:recover-admission
if redis.call("GET", KEYS[2]) then return nil end
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local active = cjson.decode(raw)
if active.phase == "live" and active.sessionId == "" and not redis.call("GET", KEYS[3]) then
  active.phase = "recovery-required"
end
if active.phase ~= "recovery-required" then return nil end

local delivery = cjson.decode(active.deliveryRaw)
local intentKey = "agent:render-intent:" .. active.dispatchId
local currentRaw = redis.call("GET", intentKey)
local revision = 1
local alreadyPublished = false
if currentRaw then
  local current = cjson.decode(currentRaw)
  alreadyPublished = current.phase == "failed" and current.eveTurnId == ARGV[1]
  revision = tonumber(current.revision) + 1
end
if not alreadyPublished then
  local intent = {
    dispatchId = active.dispatchId,
    continuationKey = delivery.continuationKey,
    messageId = active.messageId,
    sessionId = "recovery-required",
    eveTurnId = ARGV[1],
    revision = revision,
    phase = "failed",
    text = ARGV[2],
    activity = "",
    footer = ARGV[3]
  }
  if delivery.traceparent then intent.traceparent = delivery.traceparent end
  redis.call("SET", intentKey, cjson.encode(intent))
  redis.call("SADD", KEYS[4], "r:" .. active.dispatchId)
end

local shouldReport = active.recoveryReported ~= true
active.recoveryReported = true
redis.call("SET", KEYS[1], cjson.encode(active))
if shouldReport then return active.deliveryRaw end
return nil
`;

const CONFIRM_SCRIPT = `
-- wack:confirm
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local active = cjson.decode(raw)
if active.ownerToken ~= ARGV[1] then return 0 end
if active.phase ~= "live" and active.phase ~= "parked" then return 0 end
active.sessionId = ARGV[2]
redis.call("SET", KEYS[1], cjson.encode(active))
return 1
`;

const COMPLETE_SCRIPT = `
-- wack:complete
local marker = redis.call("GET", KEYS[2])
if not marker then return 0 end
local parked = cjson.decode(marker)
if parked.messageId ~= ARGV[1] or parked.sessionId ~= ARGV[2] or parked.dispatchId ~= ARGV[4]
  or parked.eveTurnId ~= ARGV[5] then
  return -1
end
local outcome = redis.call("GET", KEYS[6])
if outcome ~= "applied" and outcome ~= "discarded" then return -2 end
local raw = redis.call("GET", KEYS[1])
if not raw then
  redis.call("DEL", KEYS[2])
  redis.call("SREM", KEYS[5], ARGV[6])
  return 0
end
local active = cjson.decode(raw)
if active.phase ~= "parked" then return -1 end
if active.messageId ~= ARGV[1] or active.dispatchId ~= ARGV[4] then return -1 end
if active.sessionId ~= "" and active.sessionId ~= ARGV[2] then return -1 end
if active.eveTurnId ~= ARGV[5] then return -1 end
redis.call("DEL", KEYS[1], KEYS[2])
redis.call("SREM", KEYS[5], ARGV[6])
if redis.call("LLEN", KEYS[3]) == 0 then redis.call("SREM", KEYS[4], ARGV[6]) end
return 1
`;

const BEGIN_RESET_SCRIPT = `
-- wack:begin-reset
local existing = redis.call("GET", KEYS[1])
if existing then return existing end
redis.call("SET", KEYS[1], ARGV[1])
return ARGV[1]
`;

const COMMIT_RESET_SCRIPT = `
-- wack:commit-reset
if redis.call("GET", KEYS[5]) ~= ARGV[1] then return 0 end
local function purgeRender(deliveryRaw)
  if not deliveryRaw then return end
  local ok, delivery = pcall(cjson.decode, deliveryRaw)
  if ok and delivery.dispatchId then
    local dispatchId = delivery.dispatchId
    redis.call(
      "DEL",
      "agent:render-target:" .. dispatchId,
      "agent:render-intent:" .. dispatchId,
      "agent:render-projection:" .. dispatchId,
      "agent:render-claim:" .. dispatchId,
      "agent:render-outcome:" .. dispatchId,
      "agent:hitl-claim:" .. dispatchId
    )
    local authorizationIndex = "agent:authorization-index:" .. dispatchId
    for _, authorizationKey in ipairs(redis.call("SMEMBERS", authorizationIndex)) do
      redis.call("DEL", authorizationKey)
    end
    redis.call("DEL", authorizationIndex)
    redis.call("SREM", KEYS[8], "r:" .. dispatchId)
  end
end
for _, deliveryRaw in ipairs(redis.call("LRANGE", KEYS[1], 0, -1)) do
  purgeRender(deliveryRaw)
end
local activeRaw = redis.call("GET", KEYS[3])
if activeRaw then
  local ok, active = pcall(cjson.decode, activeRaw)
  if ok then purgeRender(active.deliveryRaw) end
end
redis.call("DEL", KEYS[1], KEYS[3], KEYS[4])
redis.call("SREM", KEYS[6], ARGV[2])
redis.call("SREM", KEYS[7], ARGV[2])

for _, deliveryRaw in ipairs(redis.call("LRANGE", KEYS[2], 0, -1)) do
  redis.call("RPUSH", KEYS[1], deliveryRaw)
end
redis.call("DEL", KEYS[2], KEYS[5])
if redis.call("LLEN", KEYS[1]) > 0 then redis.call("SADD", KEYS[6], ARGV[2]) end
return 1
`;

const PURGE_SCRIPT = `
-- wack:purge
local function purgeRender(deliveryRaw)
  if not deliveryRaw then return end
  local ok, delivery = pcall(cjson.decode, deliveryRaw)
  if ok and delivery.dispatchId then
    local dispatchId = delivery.dispatchId
    redis.call(
      "DEL",
      "agent:render-target:" .. dispatchId,
      "agent:render-intent:" .. dispatchId,
      "agent:render-projection:" .. dispatchId,
      "agent:render-claim:" .. dispatchId,
      "agent:render-outcome:" .. dispatchId,
      "agent:hitl-claim:" .. dispatchId
    )
    local authorizationIndex = "agent:authorization-index:" .. dispatchId
    for _, authorizationKey in ipairs(redis.call("SMEMBERS", authorizationIndex)) do
      redis.call("DEL", authorizationKey)
    end
    redis.call("DEL", authorizationIndex)
    redis.call("SREM", KEYS[7], "r:" .. dispatchId)
  end
end
for _, deliveryRaw in ipairs(redis.call("LRANGE", KEYS[1], 0, -1)) do
  purgeRender(deliveryRaw)
end
for _, deliveryRaw in ipairs(redis.call("LRANGE", KEYS[8], 0, -1)) do
  purgeRender(deliveryRaw)
end
local activeRaw = redis.call("GET", KEYS[2])
if activeRaw then
  local ok, active = pcall(cjson.decode, activeRaw)
  if ok then purgeRender(active.deliveryRaw) end
end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3], KEYS[6], KEYS[8], KEYS[9], KEYS[10])
redis.call("SREM", KEYS[4], ARGV[2])
redis.call("SREM", KEYS[5], ARGV[2])
return 1
`;

interface ClaimedTurn {
  readonly payload: DeliveryPayload;
  readonly claimToken: string;
}

type CompletionStatus = "completed" | "missing" | "pending" | "stale";

/** Upstash returns a stored entry as JSON text or already deserialized. */
function parseStored<T>(
  raw: unknown,
  subject: string,
  decode: (input: unknown) => Result<T, InvalidInput>,
): Result<T, InvalidInput> {
  const text = z.string().safeParse(raw);
  if (!text.success) return decode(raw);
  const parsed = jsonText.safeParse(text.data);
  return parsed.success
    ? decode(parsed.data)
    : Result.err(new InvalidInput({ subject, issues: ["entry was not valid JSON"] }));
}

function continuationKeys(values: readonly string[]): readonly string[] {
  return values.flatMap((candidate) => {
    const key = continuationKeyFromQueueMember(candidate);
    return key === undefined ? [] : [key];
  });
}

async function enqueueTurn(redis: RedisClient, payload: MessagePayload): Promise<void> {
  const delivery: DeliveryPayload = { ...payload, dispatchId: crypto.randomUUID() };
  const target: RenderTarget = {
    dispatchId: delivery.dispatchId,
    continuationKey: delivery.continuationKey,
    messageId: delivery.messageId,
    channelId: delivery.thread?.id ?? delivery.channel.id,
    authChannelId: delivery.channel.id,
    ...(delivery.thread === undefined ? {} : { authThreadId: delivery.thread.id }),
    requesterUserId: delivery.principal.userId,
    ...(delivery.anchorMessageId === undefined
      ? { replyToMessageId: delivery.messageId }
      : { anchorMessageId: delivery.anchorMessageId }),
  };
  await redis.eval(
    ENQUEUE_SCRIPT,
    [
      pendingKey(payload.continuationKey),
      QUEUE_INDEX_KEY,
      seenKey(payload.continuationKey),
      renderTargetKey(delivery.dispatchId),
      resetKey(payload.continuationKey),
      resetPendingKey(payload.continuationKey),
    ],
    [
      JSON.stringify(delivery),
      payload.messageId,
      queueMember(payload.continuationKey),
      SEEN_TTL_SECONDS,
      JSON.stringify(target),
    ],
  );
}

async function claimTurn(
  redis: RedisClient,
  continuationKey: string,
): Promise<Result<ClaimedTurn | undefined, InvalidInput>> {
  const claimToken = crypto.randomUUID();
  const claimedAt = Date.now();
  const raw: unknown = await redis.eval(
    CLAIM_SCRIPT,
    [
      pendingKey(continuationKey),
      activeKey(continuationKey),
      QUEUE_INDEX_KEY,
      resetKey(continuationKey),
    ],
    [
      claimToken,
      continuationKey,
      claimedAt,
      claimedAt + DELIVERY_LEASE_MS,
      queueMember(continuationKey),
    ],
  );
  if (raw === null || raw === undefined) return Result.ok(undefined);
  const parsed = parseStored(raw, "queued delivery", decodeDeliveryPayload);
  return Result.isError(parsed) ? parsed : Result.ok({ payload: parsed.value, claimToken });
}

async function recoverAdmission(
  redis: Pick<RedisClient, "eval">,
  continuationKey: string,
): Promise<Result<DeliveryPayload | undefined, InvalidInput>> {
  const raw: unknown = await redis.eval(
    RECOVER_ADMISSION_SCRIPT,
    [
      activeKey(continuationKey),
      resetKey(continuationKey),
      ingressKey(continuationKey),
      AGENT_RENDER_READY_SET_KEY,
    ],
    [ADMISSION_RECOVERY_EVE_TURN_ID, ADMISSION_RECOVERY_TEXT, ADMISSION_RECOVERY_FOOTER],
  );
  if (raw === null || raw === undefined) return Result.ok(undefined);
  return parseStored(raw, "recovery-required delivery", decodeDeliveryPayload);
}

async function confirmTurn(
  redis: RedisClient,
  continuationKey: string,
  claimToken: string,
  sessionId: string,
): Promise<boolean> {
  return (
    Number(
      await redis.eval(CONFIRM_SCRIPT, [activeKey(continuationKey)], [claimToken, sessionId]),
    ) === 1
  );
}

async function completeTurn(redis: RedisClient, payload: ParkedPayload): Promise<CompletionStatus> {
  const result = Number(
    await redis.eval(
      COMPLETE_SCRIPT,
      [
        activeKey(payload.continuationKey),
        parkedKey(payload.continuationKey),
        pendingKey(payload.continuationKey),
        QUEUE_INDEX_KEY,
        AGENT_READY_SET_KEY,
        renderOutcomeKey(payload.dispatchId),
      ],
      [
        payload.messageId,
        payload.sessionId,
        payload.continuationKey,
        payload.dispatchId,
        payload.eveTurnId,
        queueMember(payload.continuationKey),
      ],
    ),
  );
  if (result === 1) return "completed";
  if (result === -2) return "pending";
  return result === -1 ? "stale" : "missing";
}

async function readParked(
  redis: RedisClient,
  continuationKey: string,
): Promise<Result<ParkedPayload | undefined, InvalidInput>> {
  const raw: unknown = await redis.get(parkedKey(continuationKey));
  if (raw === null || raw === undefined) return Result.ok(undefined);
  return parseStored(raw, "parked marker", decodeParkedPayload);
}

async function beginReset(redis: RedisClient, continuationKey: string): Promise<string> {
  const token = crypto.randomUUID();
  const result: unknown = await redis.eval(
    BEGIN_RESET_SCRIPT,
    [resetKey(continuationKey)],
    [token],
  );
  const owner = z.string().min(1).safeParse(result);
  if (!owner.success) throw new Error("Redis returned an invalid reset token");
  return owner.data;
}

async function commitReset(
  redis: RedisClient,
  continuationKey: string,
  resetId: string,
): Promise<boolean> {
  return (
    Number(
      await redis.eval(
        COMMIT_RESET_SCRIPT,
        [
          pendingKey(continuationKey),
          resetPendingKey(continuationKey),
          activeKey(continuationKey),
          parkedKey(continuationKey),
          resetKey(continuationKey),
          QUEUE_INDEX_KEY,
          AGENT_READY_SET_KEY,
          AGENT_RENDER_READY_SET_KEY,
        ],
        [resetId, queueMember(continuationKey)],
      ),
    ) === 1
  );
}

async function purgeTurns(redis: RedisClient, continuationKey: string): Promise<void> {
  await redis.eval(
    PURGE_SCRIPT,
    [
      pendingKey(continuationKey),
      activeKey(continuationKey),
      parkedKey(continuationKey),
      QUEUE_INDEX_KEY,
      AGENT_READY_SET_KEY,
      seenKey(continuationKey),
      AGENT_RENDER_READY_SET_KEY,
      resetPendingKey(continuationKey),
      resetKey(continuationKey),
      ingressKey(continuationKey),
    ],
    [continuationKey, queueMember(continuationKey)],
  );
}

export function createQueueTransitions(redis: RedisClient) {
  return {
    enqueue: (payload: MessagePayload): Promise<void> => enqueueTurn(redis, payload),
    claim: (continuationKey: string): Promise<Result<ClaimedTurn | undefined, InvalidInput>> =>
      claimTurn(redis, continuationKey),
    recoverAdmission: (
      continuationKey: string,
    ): Promise<Result<DeliveryPayload | undefined, InvalidInput>> =>
      recoverAdmission(redis, continuationKey),
    confirm: (continuationKey: string, claimToken: string, sessionId: string): Promise<boolean> =>
      confirmTurn(redis, continuationKey, claimToken, sessionId),
    complete: (payload: ParkedPayload): Promise<CompletionStatus> => completeTurn(redis, payload),
    keys: async (): Promise<readonly string[]> => {
      const members = await redis.smembers(QUEUE_INDEX_KEY);
      return continuationKeys(members);
    },
    readyKeys: async (): Promise<readonly string[]> => {
      const members = await redis.smembers(AGENT_READY_SET_KEY);
      return continuationKeys(members);
    },
    parked: (continuationKey: string): Promise<Result<ParkedPayload | undefined, InvalidInput>> =>
      readParked(redis, continuationKey),
    depth: (continuationKey: string): Promise<number> => redis.llen(pendingKey(continuationKey)),
    beginReset: (continuationKey: string): Promise<string> => beginReset(redis, continuationKey),
    commitReset: (continuationKey: string, resetId: string): Promise<boolean> =>
      commitReset(redis, continuationKey, resetId),
    purge: (continuationKey: string): Promise<void> => purgeTurns(redis, continuationKey),
  };
}
