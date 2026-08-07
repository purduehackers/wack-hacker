import { createHash } from "node:crypto";

import { roleFromMemberRoles } from "../discord/index.ts";
import type { RedisClient } from "../redis/client.ts";
import type { InteractionPayload } from "../wire.ts";
import {
  ingressKey,
  interactionReceiptKey,
  renderIntentKey,
  renderTargetKey,
  resetKey,
} from "./keys.ts";

export const INTERACTION_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

const CLAIM_INTERACTION_SCRIPT = `
-- wack:claim-interaction
local receipt = redis.call("GET", KEYS[3])
if receipt then
  local decoded = cjson.decode(receipt)
  if decoded.dispatchId ~= ARGV[1]
    or decoded.renderRevision ~= tonumber(ARGV[3])
    or decoded.requestId ~= ARGV[4]
    or decoded.principalId ~= ARGV[5]
    or decoded.responseDigest ~= ARGV[8]
    or decoded.authChannelId ~= ARGV[11]
    or (decoded.authThreadId or "") ~= ARGV[12]
  then
    return -1
  end
  return decoded.status == "accepted" and 2 or 0
end

if redis.call("GET", KEYS[4]) then return -1 end
local raw = redis.call("GET", KEYS[1])
local targetRaw = redis.call("GET", KEYS[2])
if not raw or not targetRaw then return -1 end
local intent = cjson.decode(raw)
local target = cjson.decode(targetRaw)
if intent.phase ~= "streaming" or intent.dispatchId ~= ARGV[1] then return -1 end
if intent.continuationKey ~= ARGV[2] or tonumber(intent.revision) ~= tonumber(ARGV[3]) then return -1 end
if target.dispatchId ~= ARGV[1] or target.continuationKey ~= ARGV[2] then return -1 end
if target.authChannelId ~= ARGV[11] then return -1 end
if (target.authThreadId or "") ~= ARGV[12] then return -1 end
local request = nil
for _, candidate in ipairs(intent.inputRequests or {}) do
  if candidate.requestId == ARGV[4] then request = candidate break end
end
if not request or request.recipientUserId ~= target.requesterUserId then return -1 end
if request.approvalMode == "second-party" then
  local ranks = { public = 0, organizer = 1, admin = 2 }
  local actual = ranks[ARGV[15]] or -1
  local required = ranks[request.approverMinRole] or 99
  local requesterRole = ranks[ARGV[17]] or -1
  if ARGV[5] == target.requesterUserId or actual < required then return -1 end
  if ARGV[16] ~= target.requesterUserId or requesterRole < required then return -1 end
elseif ARGV[5] ~= target.requesterUserId or ARGV[16] ~= "" then
  return -1
end

if ARGV[6] == "option" then
  local valid = false
  for _, option in ipairs(request.options or {}) do
    if option.id == ARGV[7] then valid = true break end
  end
  if not valid then return -1 end
elseif ARGV[6] == "text" then
  local options = request.options or {}
  if request.kind ~= "question" then return -1 end
  if request.allowFreeform ~= true and #options > 0 then return -1 end
else
  return -1
end

if redis.call("GET", KEYS[5]) then return 0 end
redis.call("SET", KEYS[3], ARGV[9], "EX", tonumber(ARGV[10]))
redis.call("SET", KEYS[5], ARGV[13], "PX", tonumber(ARGV[14]))
return 1
`;

export interface InteractionReceiptIdentity {
  readonly dispatchId: string;
  readonly renderRevision: number;
  readonly requestId: string;
  readonly principalId: string;
  readonly responseDigest: string;
  readonly authChannelId: string;
  readonly authThreadId?: string;
}

export interface InteractionClaim {
  /** 1: acquired, 0: forwarding duplicate, 2: accepted retry, -1: stale/conflict. */
  readonly claim: number;
  readonly receiptIdentity: InteractionReceiptIdentity;
}

export async function claimInteraction(
  redis: Pick<RedisClient, "eval">,
  payload: InteractionPayload,
): Promise<InteractionClaim> {
  const responseKind = payload.optionId === undefined ? "text" : "option";
  const responseValue = payload.optionId ?? payload.freeform ?? "";
  const responseDigest = createHash("sha256")
    .update(responseKind)
    .update("\0")
    .update(responseValue)
    .digest("base64url");
  const receiptIdentity: InteractionReceiptIdentity = {
    dispatchId: payload.dispatchId,
    renderRevision: payload.renderRevision,
    requestId: payload.requestId,
    principalId: payload.principal.userId,
    responseDigest,
    authChannelId: payload.authChannelId,
    ...(payload.authThreadId === undefined ? {} : { authThreadId: payload.authThreadId }),
  };
  const forwarding = JSON.stringify({ status: "forwarding", ...receiptIdentity });
  const claim = Number(
    await redis.eval(
      CLAIM_INTERACTION_SCRIPT,
      [
        renderIntentKey(payload.dispatchId),
        renderTargetKey(payload.dispatchId),
        interactionReceiptKey(payload.interactionId),
        resetKey(payload.continuationKey),
        ingressKey(payload.continuationKey),
      ],
      [
        payload.dispatchId,
        payload.continuationKey,
        payload.renderRevision,
        payload.requestId,
        payload.principal.userId,
        responseKind,
        responseValue,
        responseDigest,
        forwarding,
        INTERACTION_RECEIPT_TTL_SECONDS,
        payload.authChannelId,
        payload.authThreadId ?? "",
        payload.interactionId,
        15 * 60_000,
        roleFromMemberRoles(payload.principal.memberRoles),
        payload.approvalRequester?.userId ?? "",
        payload.approvalRequester === undefined
          ? ""
          : roleFromMemberRoles(payload.approvalRequester.memberRoles),
      ],
    ),
  );
  return { claim, receiptIdentity };
}

export function createInteractionTransitions(redis: Pick<RedisClient, "eval" | "get" | "set">) {
  return {
    claim: (payload: InteractionPayload): Promise<InteractionClaim> =>
      claimInteraction(redis, payload),
    read: (interactionId: string): Promise<unknown> =>
      redis.get(interactionReceiptKey(interactionId)),
    accept: (
      interactionId: string,
      receiptIdentity: InteractionReceiptIdentity,
      sessionId: string,
      continuationToken: string,
    ): Promise<unknown> =>
      redis.set(
        interactionReceiptKey(interactionId),
        { status: "accepted", ...receiptIdentity, sessionId, continuationToken },
        { ex: INTERACTION_RECEIPT_TTL_SECONDS },
      ),
  };
}

export type InteractionTransitions = ReturnType<typeof createInteractionTransitions>;
