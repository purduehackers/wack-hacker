/**
 * Redis half of the bot↔agent delivery and parked-turn handshake.
 *
 * Every write to the active record here carries `KEEPTTL`. A bare `SET` clears
 * a Redis expiry, and `wack:start-delivery` runs on every delivery — without it
 * the key that `claim` had just given a bounded life became immortal again
 * moments later, which is the whole failure this directory was fixed for.
 */

import { z } from "zod";

import { stored } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";
import type { DeliveryPayload } from "../wire.ts";
import { ACTIVE_RECORD_LUA, activeKey, ingressKey, resetKey } from "./keys.ts";

/** Atomic Redis scripting surface used by delivery coordination. */
type AdmissionRedis = Pick<RedisClient, "eval">;

const DELIVERY_ADMISSION_TTL_MS = 15 * 60_000;

const START_DELIVERY_SCRIPT = `
${ACTIVE_RECORD_LUA}
-- wack:start-delivery
if redis.call("GET", KEYS[2]) then return cjson.encode({status = "resetting"}) end
local raw = redis.call("GET", KEYS[1])
if not raw then return cjson.encode({status = "stale"}) end
local active = cjson.decode(raw)
if active.dispatchId ~= ARGV[1] or active.messageId ~= ARGV[2] then
  return cjson.encode({status = "stale"})
end
if active.phase == "claimed" then
  active.phase = "live"
  active.admissionAttemptId = ARGV[3]
  writeActive(KEYS[1], active)
  redis.call("SET", KEYS[3], ARGV[3], "PX", tonumber(ARGV[4]))
  return cjson.encode({status = "start", admissionAttemptId = ARGV[3]})
end
if active.sessionId ~= "" then
  return cjson.encode({status = "accepted", sessionId = active.sessionId})
end
if active.phase == "live" then
  local admissionOwner = redis.call("GET", KEYS[3])
  if active.admissionAttemptId == ARGV[3] and admissionOwner == ARGV[3] then
    redis.call("SET", KEYS[3], ARGV[3], "PX", tonumber(ARGV[4]))
    return cjson.encode({status = "start", admissionAttemptId = ARGV[3]})
  end
  if not admissionOwner then
    active.phase = "recovery-required"
    writeActive(KEYS[1], active)
    return cjson.encode({status = "recovery-required"})
  end
end
if active.phase == "recovery-required" then
  return cjson.encode({status = "recovery-required"})
end
return cjson.encode({status = "in-progress"})
`;

const CONFIRM_DELIVERY_SCRIPT = `
${ACTIVE_RECORD_LUA}
-- wack:confirm-delivery
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local active = cjson.decode(raw)
if active.dispatchId ~= ARGV[1] or active.messageId ~= ARGV[2] then return 0 end
if active.phase ~= "live" and active.phase ~= "parked" then return 0 end
active.sessionId = ARGV[3]
writeActive(KEYS[1], active)
return 1
`;

const FINISH_ADMISSION_SCRIPT = `
-- wack:finish-admission
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

/**
 * Every shape `wack:start-delivery` can answer with. One discriminated union
 * replaces a hand-written guard chain that restated each field, and it decodes
 * whichever form Upstash returns — JSON text, or an already-deserialized value.
 */
const admissionSchema = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("start"), admissionAttemptId: z.string() }),
    z.strictObject({ status: z.literal("accepted"), sessionId: z.string() }),
    z.strictObject({
      status: z.literal(["in-progress", "recovery-required", "resetting", "stale"]),
    }),
  ])
  .readonly();

type DeliveryAdmission = z.output<typeof admissionSchema>;

function parseAdmission(raw: unknown): DeliveryAdmission {
  const parsed = stored(admissionSchema).safeParse(raw);
  if (!parsed.success) throw new Error("Redis returned an invalid delivery admission");
  return parsed.data;
}

/** Fences overlapping bot POSTs before either is allowed to call Eve `send`. */
async function startDelivery(
  redis: AdmissionRedis,
  payload: DeliveryPayload,
): Promise<DeliveryAdmission> {
  // Fresh per call, so it identifies this attempt only. A retried route
  // invocation arrives with a new id and is fenced by `phase`/`admissionOwner`
  // in the script above, not by matching this value.
  const admissionAttemptId = crypto.randomUUID();
  const raw: unknown = await redis.eval(
    START_DELIVERY_SCRIPT,
    [
      activeKey(payload.continuationKey),
      resetKey(payload.continuationKey),
      ingressKey(payload.continuationKey),
    ],
    [payload.dispatchId, payload.messageId, admissionAttemptId, DELIVERY_ADMISSION_TTL_MS],
  );
  const admission = parseAdmission(raw);
  if (admission.status === "recovery-required") {
    console.error(
      JSON.stringify({
        event: "discord.delivery.recovery_required",
        continuationKey: payload.continuationKey,
        dispatchId: payload.dispatchId,
        messageId: payload.messageId,
        remediation: "reset-conversation-before-retrying",
      }),
    );
  }
  return admission;
}

/** Releases the reset-visible admission lease after Eve send has settled. */
async function finishAdmission(
  redis: AdmissionRedis,
  continuationKey: string,
  admissionAttemptId: string,
): Promise<boolean> {
  return (
    Number(
      await redis.eval(
        FINISH_ADMISSION_SCRIPT,
        [ingressKey(continuationKey)],
        [admissionAttemptId],
      ),
    ) === 1
  );
}

/** Makes an accepted retry answerable even if the first bot lost its response. */
async function confirmDelivery(
  redis: AdmissionRedis,
  payload: DeliveryPayload,
  sessionId: string,
): Promise<boolean> {
  return (
    Number(
      await redis.eval(
        CONFIRM_DELIVERY_SCRIPT,
        [activeKey(payload.continuationKey)],
        [payload.dispatchId, payload.messageId, sessionId],
      ),
    ) === 1
  );
}

export function createAdmissionTransitions(redis: AdmissionRedis) {
  return {
    start: (payload: DeliveryPayload): Promise<DeliveryAdmission> => startDelivery(redis, payload),
    finish: (continuationKey: string, admissionAttemptId: string): Promise<boolean> =>
      finishAdmission(redis, continuationKey, admissionAttemptId),
    confirm: (payload: DeliveryPayload, sessionId: string): Promise<boolean> =>
      confirmDelivery(redis, payload, sessionId),
  };
}
