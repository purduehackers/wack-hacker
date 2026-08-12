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
import type { DeliveryPayload, MessagePayload } from "../../wire.ts";
import { decodeDeliveryPayload } from "../../wire.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderTargetKey,
  resetKey,
  resetPendingKey,
  seenKey,
} from "../keys.ts";
import { LEASE_LUA, LeaseDuration, RECORD_TTL_MS } from "../lease.ts";

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

export interface ClaimedDelivery {
  readonly payload: DeliveryPayload;
  readonly claimToken: string;
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
    // The script returns the stored delivery as JSON text. Parsed straight into
    // the wire decoder, which is the schema that owns this shape — rather than
    // through a codec that yields `unknown` and defers the real check to
    // whoever remembers to run it.
    const text = z.string().safeParse(raw);
    if (!text.success) {
      return Result.err(
        new InvalidInput({ subject: "claimed delivery", issues: ["expected JSON text"] }),
      );
    }
    const decoded = decodeDeliveryPayload(JSON.parse(text.data));
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

  /** Advertised so a caller can drop a conversation from the ready set. */
  async unadvertise(continuationKey: string): Promise<void> {
    await this.redis.srem(AGENT_READY_SET_KEY, queueMember(continuationKey));
  }
}
