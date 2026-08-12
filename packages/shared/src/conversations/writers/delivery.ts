/**
 * The only thing that writes the delivery record.
 *
 * One method per transition, named for the transition, with no `set` or `update`
 * escape hatch — so the set of things that can happen to this record is the set
 * of methods on this class, readable in one screen. That was the actual problem
 * with what this replaces: not that the Lua was hard, but that finding all of it
 * meant grepping three files and knowing which of six fences applied.
 *
 * Every script fences before it writes and writes through `writeRecord`, which
 * carries `KEEPTTL`. A bare `SET` clears a Redis expiry, and that mistake —
 * stripping the key's bounded life immediately after `claim` set it — is what
 * made conversations immortal once and wedged four of them for a day.
 */

import { z } from "zod";

import { InvalidInput } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload } from "../../wire.ts";
import { decodeDeliveryPayload } from "../../wire.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderOutcomeKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
  seenKey,
} from "../keys.ts";
import { LEASE_LUA, LeaseDuration, RECORD_TTL_MS } from "../lease.ts";
import { redisValue } from "../redis-value.ts";

/** Completed-message tombstones are only needed across plausible retries. */
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Prepended to every script here.
 *
 * `writeRecord` is the single sanctioned rewrite, for the reason in this file's
 * header. It sits beside the lease helpers so a fence and the write it guards
 * are never separated.
 */
const RECORD_LUA = `
${LEASE_LUA}
local function writeRecord(key, record)
  redis.call("SET", key, cjson.encode(record), "KEEPTTL")
end
`;

const ENQUEUE = `
-- delivery:enqueue
local firstSighting = redis.call("SADD", KEYS[3], ARGV[2])
redis.call("EXPIRE", KEYS[3], tonumber(ARGV[4]))
if firstSighting == 0 then return 0 end
-- A reset in flight diverts new work to a shadow queue, so the cutover can
-- clear what it is replacing without discarding what arrived meanwhile.
local resetting = redis.call("GET", KEYS[5])
redis.call("RPUSH", resetting and KEYS[6] or KEYS[1], ARGV[1])
-- Indexed only when it landed on the real queue. Indexing a diverted delivery
-- advertises work the claim cannot see, which is how the sweep learned to spin.
if not resetting then redis.call("SADD", KEYS[2], ARGV[3]) end
redis.call("SET", KEYS[4], ARGV[5])
return 1
`;

const CLAIM = `
${RECORD_LUA}
-- delivery:claim
if redis.call("GET", KEYS[4]) then return nil end
local raw = redis.call("GET", KEYS[2])
if raw then
  local record = cjson.decode(raw)
  -- Anything past the handoff belongs to a running turn; only the turn lease
  -- releases those, never a competing claim.
  if record.phase ~= "claimed" then return nil end
  if leaseHeld(record.handoff, ARGV[1], ARGV[3]) then return record.deliveryRaw end
  if not leaseAvailable(record.handoff, ARGV[3]) then return nil end
  record.handoff = { holder = ARGV[1], expiresAtMs = tonumber(ARGV[4]) }
  writeRecord(KEYS[2], record)
  return record.deliveryRaw
end
local deliveryRaw = redis.call("LPOP", KEYS[1])
if not deliveryRaw then
  -- Nothing queued: drop the advertisement so the sweep stops visiting.
  redis.call("SREM", KEYS[3], ARGV[5])
  return nil
end
local delivery = cjson.decode(deliveryRaw)
redis.call("SET", KEYS[2], cjson.encode({
  phase = "claimed",
  dispatchId = delivery.dispatchId,
  messageId = delivery.messageId,
  sessionId = "",
  handoff = { holder = ARGV[1], expiresAtMs = tonumber(ARGV[4]) },
  turn = { holder = delivery.dispatchId, expiresAtMs = tonumber(ARGV[6]) },
  deliveryRaw = deliveryRaw
}), "PX", tonumber(ARGV[7]))
return deliveryRaw
`;

const REFRESH_TURN = `
${RECORD_LUA}
-- delivery:refresh-turn
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
-- Fenced on the delivery rather than the conversation: a follower left over
-- from a turn that has moved on must not hold the one that replaced it.
if record.turn.holder ~= ARGV[1] then return 0 end
if record.phase ~= "live" then return 0 end
record.turn.expiresAtMs = tonumber(ARGV[2]) + tonumber(ARGV[3])
writeRecord(KEYS[1], record)
return 1
`;

const CONFIRM_SESSION = `
${RECORD_LUA}
-- delivery:confirm-session
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if not leaseHeld(record.handoff, ARGV[1], ARGV[3]) then return 0 end
if record.phase ~= "live" and record.phase ~= "parked" then return 0 end
record.sessionId = ARGV[2]
writeRecord(KEYS[1], record)
return 1
`;

/**
 * Three scripts and a second key, collapsed.
 *
 * The old handshake spread `start` / `confirm` / `finish` across `admission.ts`
 * with its own lease in `agent:ingress:<key>`. All of it answered one question —
 * may this process hand the delivery to eve, and if not, why not — so it is one
 * compare-and-set returning the reason.
 *
 * The five statuses survive because the caller genuinely branches on all of
 * them: eve has no callable "is a turn already running", so this is the only
 * place that answer exists.
 */
const MARK_LIVE = `
${RECORD_LUA}
-- delivery:mark-live
if redis.call("GET", KEYS[2]) then return "resetting" end
local raw = redis.call("GET", KEYS[1])
if not raw then return "stale" end
local record = cjson.decode(raw)
if record.dispatchId ~= ARGV[1] or record.messageId ~= ARGV[2] then return "stale" end
-- Already acknowledged: a retry of the same delivery is answered from the
-- record rather than run again.
if record.sessionId ~= "" then return "accepted:" .. record.sessionId end
if record.phase == "claimed" then
  record.phase = "live"
  record.ingress = { holder = ARGV[3], expiresAtMs = tonumber(ARGV[4]) }
  writeRecord(KEYS[1], record)
  return "start"
end
if record.phase == "live" then
  -- Live, unacknowledged, and nobody is holding the ingress slot: whoever took
  -- it never came back, and nobody can tell whether eve began the turn. Held
  -- rather than retried, because retrying might run it twice.
  if leaseAvailable(record.ingress, ARGV[5]) then
    record.phase = "recovery-required"
    writeRecord(KEYS[1], record)
    return "recovery-required"
  end
  return "in-progress"
end
if record.phase == "recovery-required" then return "recovery-required" end
return "in-progress"
`;

const RELEASE_INGRESS = `
${RECORD_LUA}
-- delivery:release-ingress
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if not record.ingress or record.ingress.holder ~= ARGV[1] then return 0 end
record.ingress = nil
writeRecord(KEYS[1], record)
return 1
`;

/**
 * Release the conversation once the turn is finished and its paint is durable.
 *
 * The render outcome check is the cross-machine guard. It was an ordering
 * comment in the bot's sweep — "render first so a durable terminal outcome is
 * present" — enforced by one `if` buried here. Ordering is not a guarantee.
 */
const COMPLETE = `
-- delivery:complete
local marker = redis.call("GET", KEYS[2])
if not marker then return 0 end
local parked = cjson.decode(marker)
if parked.messageId ~= ARGV[1] or parked.sessionId ~= ARGV[2]
  or parked.dispatchId ~= ARGV[3] or parked.eveTurnId ~= ARGV[4] then
  return -1
end
local outcome = redis.call("GET", KEYS[6])
if outcome ~= "applied" and outcome ~= "discarded" then return -2 end
local raw = redis.call("GET", KEYS[1])
if not raw then
  redis.call("DEL", KEYS[2])
  redis.call("SREM", KEYS[5], ARGV[5])
  return 0
end
local record = cjson.decode(raw)
if record.phase ~= "parked" then return -1 end
if record.messageId ~= ARGV[1] or record.dispatchId ~= ARGV[3] then return -1 end
if record.sessionId ~= "" and record.sessionId ~= ARGV[2] then return -1 end
if record.eveTurnId ~= ARGV[4] then return -1 end
redis.call("DEL", KEYS[1], KEYS[2])
redis.call("SREM", KEYS[5], ARGV[5])
if redis.call("LLEN", KEYS[3]) == 0 then redis.call("SREM", KEYS[4], ARGV[5]) end
return 1
`;

export interface ClaimedDelivery {
  readonly payload: DeliveryPayload;
  readonly claimToken: string;
}

/** What `complete` did, in the caller's vocabulary rather than a Lua number. */
export type CompletionStatus = "completed" | "missing" | "pending" | "stale";

/**
 * Whether this process may hand the delivery to eve.
 *
 * `attempt` is the ingress holder, and the caller must give it back through
 * `releaseIngress` once eve has answered — otherwise the slot stays taken until
 * its lease lapses and every later delivery reads `in-progress`.
 */
export type Admission =
  | { readonly status: "start"; readonly attempt: string }
  | { readonly status: "accepted"; readonly sessionId: string }
  | { readonly status: "in-progress" | "recovery-required" | "resetting" | "stale" };

/**
 * The script answers with a word, and `accepted` carries its session after a
 * colon — the one status with a payload, kept in-band so the whole answer is
 * one atomic read rather than a word plus a follow-up lookup that could race.
 */
function readAdmission(raw: unknown, attempt: string): Admission {
  const text = z.string().safeParse(raw);
  if (!text.success) return { status: "stale" };
  const [status = "", sessionId = ""] = text.data.split(":", 2);
  if (status === "start") return { status: "start", attempt };
  if (status === "accepted" && sessionId !== "") return { status: "accepted", sessionId };
  const known = z
    .enum(["in-progress", "recovery-required", "resetting", "stale"])
    .safeParse(status);
  return { status: known.success ? known.data : "stale" };
}

export class DeliveryWriter {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /**
   * Put a message on the queue, once.
   *
   * The dedupe set is the gate: a Discord id seen before returns without
   * queueing anything, which is the only reason a redelivered webhook does not
   * run a turn twice.
   */
  async enqueue(payload: MessagePayload, delivery: DeliveryPayload, target: string): Promise<void> {
    await this.redis.eval(
      ENQUEUE,
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
        target,
      ],
    );
  }

  /** Take the next delivery, or renew a handoff this caller already holds. */
  async claim(continuationKey: string): Promise<Result<ClaimedDelivery | undefined, InvalidInput>> {
    const claimToken = crypto.randomUUID();
    const now = Date.now();
    const raw: unknown = await this.redis.eval(
      CLAIM,
      [
        pendingKey(continuationKey),
        activeKey(continuationKey),
        QUEUE_INDEX_KEY,
        resetKey(continuationKey),
      ],
      [
        claimToken,
        continuationKey,
        now,
        now + LeaseDuration.Handoff,
        queueMember(continuationKey),
        now + LeaseDuration.Turn,
        RECORD_TTL_MS,
      ],
    );
    if (raw === null || raw === undefined) return Result.ok(undefined);
    // Normalised, then handed straight to the decoder that owns this shape.
    // The script stores the delivery as JSON text, but Upstash may return it
    // already parsed — assuming either form rejects the other.
    const decoded = decodeDeliveryPayload(redisValue(raw));
    return Result.isError(decoded) ? decoded : Result.ok({ payload: decoded.value, claimToken });
  }

  /**
   * Push the turn's hold out because something proved it is still working.
   *
   * `false` means this delivery no longer owns the turn, and the caller should
   * stop rather than keep reporting on a conversation that moved on.
   */
  async refreshTurn(continuationKey: string, dispatchId: string): Promise<boolean> {
    const moved = await this.redis.eval(
      REFRESH_TURN,
      [activeKey(continuationKey)],
      [dispatchId, Date.now(), LeaseDuration.Turn],
    );
    return Number(moved) === 1;
  }

  /** Record which eve session took the delivery. */
  async confirmSession(
    continuationKey: string,
    claimToken: string,
    sessionId: string,
  ): Promise<boolean> {
    const confirmed = await this.redis.eval(
      CONFIRM_SESSION,
      [activeKey(continuationKey)],
      [claimToken, sessionId, Date.now()],
    );
    return Number(confirmed) === 1;
  }

  /**
   * Ask whether this process may hand the delivery to eve.
   *
   * `accepted` carries the session of an earlier attempt, so a retry is answered
   * from the record instead of running the turn again.
   */
  async markLive(
    continuationKey: string,
    dispatchId: string,
    messageId: string,
  ): Promise<Admission> {
    const attempt = crypto.randomUUID();
    const now = Date.now();
    const raw: unknown = await this.redis.eval(
      MARK_LIVE,
      [activeKey(continuationKey), resetKey(continuationKey)],
      [dispatchId, messageId, attempt, now + LeaseDuration.Ingress, now],
    );
    return readAdmission(raw, attempt);
  }

  /** Give up the ingress slot once eve has answered, however it answered. */
  async releaseIngress(continuationKey: string, attempt: string): Promise<boolean> {
    const released = await this.redis.eval(
      RELEASE_INGRESS,
      [activeKey(continuationKey)],
      [attempt],
    );
    return Number(released) === 1;
  }

  /** Release the conversation. Refuses until the terminal paint is durable. */
  async complete(parked: ParkedPayload): Promise<CompletionStatus> {
    const outcome = Number(
      await this.redis.eval(
        COMPLETE,
        [
          activeKey(parked.continuationKey),
          parkedKey(parked.continuationKey),
          pendingKey(parked.continuationKey),
          QUEUE_INDEX_KEY,
          AGENT_READY_SET_KEY,
          renderOutcomeKey(parked.dispatchId),
        ],
        [
          parked.messageId,
          parked.sessionId,
          parked.dispatchId,
          parked.eveTurnId,
          queueMember(parked.continuationKey),
        ],
      ),
    );
    if (outcome === 1) return "completed";
    if (outcome === -2) return "pending";
    return outcome === -1 ? "stale" : "missing";
  }

  /** Advertised so a caller can drop a conversation from the ready set. */
  async unadvertise(continuationKey: string): Promise<void> {
    await this.redis.srem(AGENT_READY_SET_KEY, queueMember(continuationKey));
  }
}
