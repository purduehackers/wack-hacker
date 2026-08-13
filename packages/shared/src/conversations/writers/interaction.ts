/**
 * The only thing that writes interaction receipts.
 *
 * One script does the whole admission, because every part of it has to be decided
 * against the same instant of the render intent: the click names a revision, and
 * a revision that has moved on means the buttons the person pressed are no longer
 * the buttons being offered. Split across reads and a write, a fast second click
 * answers a question that was already replaced.
 *
 * It also takes the delivery's ingress lease. An answer and a message enter eve
 * through the same slot, so a click arriving mid-handover waits rather than racing
 * it — see `records/delivery.ts` for why that slot is a lease on the record rather
 * than the separate key it used to be.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { roleFromMemberRoles } from "../../discord/index.ts";
import { jsonCodec } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import type { InteractionPayload } from "../../wire.ts";
import {
  activeKey,
  interactionReceiptKey,
  renderIntentKey,
  renderTargetKey,
  resetKey,
} from "../keys.ts";
import { LeaseDuration } from "../lease.ts";
import { DELIVERY_RECORD_LUA } from "../records/delivery.ts";
import type { InteractionIdentity } from "../records/interaction.ts";
import { interactionReceiptSchema, RECEIPT_TTL_SECONDS } from "../records/interaction.ts";

const receiptCodec = jsonCodec(interactionReceiptSchema);

const CLAIM = `
${DELIVERY_RECORD_LUA}
-- interaction:claim
local receipt = redis.call("GET", KEYS[3])
if receipt then
  local decoded = cjson.decode(receipt)
  -- A receipt that does not describe this click is an id being reused, which is
  -- a conflict rather than the duplicate the retry path is for.
  if decoded.dispatchId ~= ARGV[1]
    or decoded.renderRevision ~= tonumber(ARGV[3])
    or decoded.requestId ~= ARGV[4]
    or decoded.principalId ~= ARGV[5]
    or decoded.responseDigest ~= ARGV[8]
    or decoded.authChannelId ~= ARGV[11]
    or (decoded.authThreadId or "") ~= ARGV[12]
  then
    return "stale"
  end
  return decoded.status == "accepted" and "accepted" or "in-progress"
end

if redis.call("GET", KEYS[4]) then return "stale" end
local raw = redis.call("GET", KEYS[1])
local targetRaw = redis.call("GET", KEYS[2])
if not raw or not targetRaw then return "stale" end
local intent = cjson.decode(raw)
local target = cjson.decode(targetRaw)
if intent.phase ~= "streaming" or intent.dispatchId ~= ARGV[1] then return "stale" end
if intent.continuationKey ~= ARGV[2] or tonumber(intent.revision) ~= tonumber(ARGV[3]) then return "stale" end
if target.dispatchId ~= ARGV[1] or target.continuationKey ~= ARGV[2] then return "stale" end
if target.authChannelId ~= ARGV[11] then return "stale" end
if (target.authThreadId or "") ~= ARGV[12] then return "stale" end
local request = nil
for _, candidate in ipairs(intent.inputRequests or {}) do
  if candidate.requestId == ARGV[4] then request = candidate break end
end
if not request or request.recipientUserId ~= target.requesterUserId then return "stale" end
if request.approvalMode == "second-party" then
  -- Somebody other than the requester, senior enough, approving on their behalf.
  local ranks = { public = 0, organizer = 1, admin = 2 }
  local actual = ranks[ARGV[15]] or -1
  local required = ranks[request.approverMinRole] or 99
  local requesterRole = ranks[ARGV[17]] or -1
  if ARGV[5] == target.requesterUserId or actual < required then return "stale" end
  if ARGV[16] ~= target.requesterUserId or requesterRole < required then return "stale" end
elseif ARGV[5] ~= target.requesterUserId or ARGV[16] ~= "" then
  return "stale"
end

if ARGV[6] == "option" then
  local valid = false
  for _, option in ipairs(request.options or {}) do
    if option.id == ARGV[7] then valid = true break end
  end
  if not valid then return "stale" end
elseif ARGV[6] == "text" then
  local options = request.options or {}
  if request.kind ~= "question" then return "stale" end
  if request.allowFreeform ~= true and #options > 0 then return "stale" end
else
  return "stale"
end

-- The delivery record can legitimately be gone — a turn that parked and finished
-- leaves none — and a click arriving then has nothing to queue behind.
local activeRaw = redis.call("GET", KEYS[5])
if activeRaw then
  local record = cjson.decode(activeRaw)
  if not leaseAvailable(record.ingress, ARGV[18]) then return "in-progress" end
  record.ingress = { holder = ARGV[13], expiresAtMs = tonumber(ARGV[18]) + tonumber(ARGV[14]) }
  writeRecord(KEYS[5], record)
end
redis.call("SET", KEYS[3], ARGV[9], "EX", tonumber(ARGV[10]))
return "claimed"
`;

/**
 * Whether this click may be forwarded to eve.
 *
 * `claimed` is the only one that runs the turn. `in-progress` is a duplicate that
 * should wait; `accepted` is a duplicate whose answer already exists and must be
 * replayed rather than recomputed; `stale` is everything that no longer matches
 * what is on screen.
 */
export type InteractionClaim = "claimed" | "in-progress" | "accepted" | "stale";

export interface ClaimedInteraction {
  readonly claim: InteractionClaim;
  /** The fence the eventual receipt must carry, computed once here. */
  readonly identity: InteractionIdentity;
}

export class InteractionWriter {
  private readonly redis: Pick<RedisClient, "eval" | "set">;

  constructor(redis: Pick<RedisClient, "eval" | "set">) {
    this.redis = redis;
  }

  /** Admit one click, or say why not. */
  async claim(payload: InteractionPayload): Promise<ClaimedInteraction> {
    const responseKind = payload.optionId === undefined ? "text" : "option";
    const responseValue = payload.optionId ?? payload.freeform ?? "";
    const identity: InteractionIdentity = {
      dispatchId: payload.dispatchId,
      renderRevision: payload.renderRevision,
      requestId: payload.requestId,
      principalId: payload.principal.userId,
      responseDigest: digestOf(responseKind, responseValue),
      authChannelId: payload.authChannelId,
      ...(payload.authThreadId === undefined ? {} : { authThreadId: payload.authThreadId }),
    };
    const raw: unknown = await this.redis.eval(
      CLAIM,
      [
        renderIntentKey(payload.dispatchId),
        renderTargetKey(payload.dispatchId),
        interactionReceiptKey(payload.interactionId),
        resetKey(payload.continuationKey),
        activeKey(payload.continuationKey),
      ],
      [
        payload.dispatchId,
        payload.continuationKey,
        payload.renderRevision,
        payload.requestId,
        payload.principal.userId,
        responseKind,
        responseValue,
        identity.responseDigest,
        z.encode(receiptCodec, { status: "forwarding", ...identity }),
        RECEIPT_TTL_SECONDS,
        payload.authChannelId,
        payload.authThreadId ?? "",
        payload.interactionId,
        LeaseDuration.Ingress,
        roleFromMemberRoles(payload.principal.memberRoles),
        payload.approvalRequester?.userId ?? "",
        payload.approvalRequester === undefined
          ? ""
          : roleFromMemberRoles(payload.approvalRequester.memberRoles),
        Date.now(),
      ],
    );
    return { claim: readClaim(raw), identity };
  }

  /** Record the answer, so a Discord retry replays it rather than re-running it. */
  async accept(
    interactionId: string,
    identity: InteractionIdentity,
    sessionId: string,
    continuationToken: string,
  ): Promise<void> {
    await this.redis.set(
      interactionReceiptKey(interactionId),
      z.encode(receiptCodec, { status: "accepted", ...identity, sessionId, continuationToken }),
      { ex: RECEIPT_TTL_SECONDS },
    );
  }
}

/**
 * Hash of the answer rather than the answer.
 *
 * The kind is mixed in with a separator so an option id can never collide with
 * freeform text that happens to spell it.
 */
function digestOf(kind: string, value: string): string {
  return createHash("sha256").update(kind).update("\0").update(value).digest("base64url");
}

/** Anything the script did not say is treated as stale, which is the safe answer. */
function readClaim(raw: unknown): InteractionClaim {
  const known = z.enum(["claimed", "in-progress", "accepted", "stale"]).safeParse(raw);
  return known.success ? known.data : "stale";
}
