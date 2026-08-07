/** Redis half of the bot↔agent delivery and parked-turn handshake. */

import type { RedisClient } from "../redis/client.ts";
import type { DeliveryPayload } from "../wire.ts";
import { activeKey, ingressKey, resetKey } from "./keys.ts";

/** Atomic Redis scripting surface used by delivery coordination. */
export type AdmissionRedis = Pick<RedisClient, "eval">;

export const DELIVERY_ADMISSION_TTL_MS = 15 * 60_000;

const START_DELIVERY_SCRIPT = `
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
  redis.call("SET", KEYS[1], cjson.encode(active))
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
    redis.call("SET", KEYS[1], cjson.encode(active))
    return cjson.encode({status = "recovery-required"})
  end
end
if active.phase == "recovery-required" then
  return cjson.encode({status = "recovery-required"})
end
return cjson.encode({status = "in-progress"})
`;

const CONFIRM_DELIVERY_SCRIPT = `
-- wack:confirm-delivery
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local active = cjson.decode(raw)
if active.dispatchId ~= ARGV[1] or active.messageId ~= ARGV[2] then return 0 end
if active.phase ~= "live" and active.phase ~= "parked" then return 0 end
active.sessionId = ARGV[3]
redis.call("SET", KEYS[1], cjson.encode(active))
return 1
`;

const FINISH_ADMISSION_SCRIPT = `
-- wack:finish-admission
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

export type DeliveryAdmission =
  | { readonly status: "start"; readonly admissionAttemptId: string }
  | { readonly status: "accepted"; readonly sessionId: string }
  | { readonly status: "in-progress" | "recovery-required" | "resetting" | "stale" };

function parseAdmission(raw: unknown): DeliveryAdmission {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof value !== "object" || value === null || !("status" in value)) {
    throw new Error("Redis returned an invalid delivery admission");
  }
  const status = value.status;
  if (
    status === "start" &&
    "admissionAttemptId" in value &&
    typeof value.admissionAttemptId === "string"
  ) {
    return { status, admissionAttemptId: value.admissionAttemptId };
  }
  if (
    status === "in-progress" ||
    status === "recovery-required" ||
    status === "resetting" ||
    status === "stale"
  ) {
    return { status };
  }
  if (status === "accepted" && "sessionId" in value && typeof value.sessionId === "string") {
    return { status, sessionId: value.sessionId };
  }
  throw new Error("Redis returned an invalid delivery admission");
}

/** Fences overlapping bot POSTs before either is allowed to call Eve `send`. */
export async function startDelivery(
  redis: AdmissionRedis,
  payload: DeliveryPayload,
  /** Stable within one route invocation, and therefore across Upstash retries. */
  admissionAttemptId: string = crypto.randomUUID(),
): Promise<DeliveryAdmission> {
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
export async function finishAdmission(
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
export async function confirmDelivery(
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
    start: (payload: DeliveryPayload, admissionAttemptId?: string): Promise<DeliveryAdmission> =>
      startDelivery(redis, payload, admissionAttemptId),
    finish: (continuationKey: string, admissionAttemptId: string): Promise<boolean> =>
      finishAdmission(redis, continuationKey, admissionAttemptId),
    confirm: (payload: DeliveryPayload, sessionId: string): Promise<boolean> =>
      confirmDelivery(redis, payload, sessionId),
  };
}

export type AdmissionTransitions = ReturnType<typeof createAdmissionTransitions>;
