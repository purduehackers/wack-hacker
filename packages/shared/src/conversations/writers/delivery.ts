/**
 * The only thing that writes the delivery record.
 *
 * One method per transition, named for the transition, with no `set` or `update`
 * escape hatch — so the set of things that can happen to this record is the set
 * of methods on this class, readable in one screen.
 *
 * Every script fences before it writes and writes through `writeRecord`, which
 * carries `KEEPTTL`. A bare `SET` clears a Redis expiry, and that mistake once
 * made conversations immortal moments after `claim` had bounded them.
 */

import { z } from "zod";

import { InvalidInput, Transient } from "../../errors.ts";
import type { RedisClient } from "../../redis/client.ts";
import { Result } from "../../result/index.ts";
import type { DeliveryPayload, MessagePayload, ParkedPayload } from "../../wire.ts";
import { decodeDeliveryPayload } from "../../wire.ts";
import { evalFlag, redisValue } from "../io.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  pendingKey,
  QUEUE_INDEX_KEY,
  queueMember,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderTargetKey,
  resetKey,
  resetPendingKey,
  seenKey,
} from "../keys.ts";
import { LeaseDuration, RECORD_TTL_MS } from "../lease.ts";
import { DeliveryReader } from "../readers/delivery.ts";
import { DELIVERY_RECORD_LUA } from "../records/delivery.ts";
import { RENDER_TTL_SECONDS, renderTargetFor } from "../records/render.ts";

/** Completed-message tombstones are only needed across plausible retries. */
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long a reset barrier may block a conversation.
 *
 * Six scripts refuse while it exists, so a `beginReset` whose follow-through
 * never lands would block the conversation permanently. A reset that has not
 * completed in an hour is not going to.
 */
const RESET_BARRIER_TTL_SECONDS = 60 * 60;

/** Synthetic turn ids, so an intent this layer authored is distinguishable. */
const EXPIRY_TURN_ID = "delivery-lease-lapsed";
const RECOVERY_TURN_ID = "delivery-unacknowledged";

const EXPIRY_TEXT = "I stopped working on this — it went quiet for too long without finishing.";
const EXPIRY_FOOTER = "Send the message again to retry.";
/** Exported because the bot renders the same notice when it refuses a delivery. */
export const RECOVERY_TEXT =
  "I couldn't safely finish starting this turn, so I stopped rather than risk running it twice.";
export const RECOVERY_FOOTER =
  "React ✅ to this message to reset the conversation before retrying, or start a new thread.";

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
redis.call("SET", KEYS[4], ARGV[5], "EX", tonumber(ARGV[6]))
return 1
`;

const CLAIM = `
${DELIVERY_RECORD_LUA}
-- delivery:claim
if redis.call("GET", KEYS[4]) then return nil end
local raw = redis.call("GET", KEYS[2])
if raw then
  local record = cjson.decode(raw)
  -- Anything past the handoff belongs to a running turn; only the turn lease
  -- releases those, never a competing claim.
  if record.phase ~= "claimed" then return nil end
  if leaseHeld(record.handoff, ARGV[1], ARGV[2]) then return record.deliveryRaw end
  if not leaseAvailable(record.handoff, ARGV[2]) then return nil end
  record.handoff = { holder = ARGV[1], expiresAtMs = tonumber(ARGV[3]) }
  writeRecord(KEYS[2], record)
  return record.deliveryRaw
end
local deliveryRaw = redis.call("LPOP", KEYS[1])
if not deliveryRaw then
  -- Nothing queued: drop the advertisement so the sweep stops visiting.
  redis.call("SREM", KEYS[3], ARGV[4])
  return nil
end
local delivery = cjson.decode(deliveryRaw)
redis.call("SET", KEYS[2], cjson.encode({
  phase = "claimed",
  dispatchId = delivery.dispatchId,
  messageId = delivery.messageId,
  sessionId = "",
  handoff = { holder = ARGV[1], expiresAtMs = tonumber(ARGV[3]) },
  turn = { holder = delivery.dispatchId, expiresAtMs = tonumber(ARGV[5]) },
  deliveryRaw = deliveryRaw
}), "PX", tonumber(ARGV[6]))
return deliveryRaw
`;

const REFRESH_TURN = `
${DELIVERY_RECORD_LUA}
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
${DELIVERY_RECORD_LUA}
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
 * May this process hand the delivery to eve, and if not, why not.
 *
 * The five statuses survive because the caller genuinely branches on all of
 * them: eve has no callable "is a turn already running", so this is the only
 * place that answer exists.
 */
const MARK_LIVE = `
${DELIVERY_RECORD_LUA}
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
${DELIVERY_RECORD_LUA}
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
 * The render outcome check is the cross-machine guard. It was an ordering comment
 * in the bot's sweep, enforced by one `if` buried here; ordering is not a
 * guarantee.
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

/**
 * Announce a terminal failure, so a turn that stops says so.
 *
 * Shared by the two bad endings because the announcement is the same shape
 * either way and only the words differ. Redis expiry is invisible, and a turn
 * that vanishes mid-conversation is worse than one that says it stopped.
 */
const ANNOUNCE_FAILURE_LUA = `
local function announceFailure(intentKey, readySet, member, record, eveTurnId, text, footer, ttl)
  local delivery = cjson.decode(record.deliveryRaw)
  local currentRaw = redis.call("GET", intentKey)
  local revision = 1
  if currentRaw then
    local current = cjson.decode(currentRaw)
    -- Already announced this exact ending: leave it alone so a repeated sweep
    -- does not churn the revision and re-wake the renderer.
    if current.phase == "failed" and current.eveTurnId == eveTurnId then return false end
    revision = tonumber(current.revision) + 1
  end
  local intent = {
    dispatchId = record.dispatchId,
    continuationKey = delivery.continuationKey,
    messageId = record.messageId,
    sessionId = record.sessionId ~= "" and record.sessionId or eveTurnId,
    eveTurnId = eveTurnId,
    revision = revision,
    phase = "failed",
    text = text,
    activity = "",
    footer = footer
  }
  if delivery.traceparent then intent.traceparent = delivery.traceparent end
  redis.call("SET", intentKey, cjson.encode(intent), "EX", tonumber(ttl))
  redis.call("SADD", readySet, member)
  return true
end
`;

/**
 * Give up on a turn whose hold has lapsed.
 *
 * The lease is refreshed by evidence of progress, so a lapsed one means nothing
 * has shown its work for a full lease period.
 */
const EXPIRE = `
${DELIVERY_RECORD_LUA}
${ANNOUNCE_FAILURE_LUA}
-- delivery:expire
if redis.call("GET", KEYS[2]) then return nil end
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local record = cjson.decode(raw)
if not leaseAvailable(record.turn, ARGV[4]) then return nil end
announceFailure(KEYS[3], KEYS[4], ARGV[6], record, ARGV[1], ARGV[2], ARGV[3], ARGV[7])
redis.call("DEL", KEYS[1], KEYS[5])
redis.call("SREM", KEYS[8], ARGV[5])
if redis.call("LLEN", KEYS[6]) == 0 then redis.call("SREM", KEYS[7], ARGV[5]) end
return record.deliveryRaw
`;

/**
 * Report — at most once — a delivery that reached the agent and was never
 * acknowledged. A sweep visits every conversation on every pass, so without the
 * flag a stuck delivery would log a line per pass forever.
 */
const RECOVER = `
${DELIVERY_RECORD_LUA}
${ANNOUNCE_FAILURE_LUA}
-- delivery:recover
if redis.call("GET", KEYS[2]) then return nil end
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local record = cjson.decode(raw)
if record.phase ~= "recovery-required" then return nil end
announceFailure(KEYS[3], KEYS[4], ARGV[4], record, ARGV[1], ARGV[2], ARGV[3], ARGV[5])
if record.recoveryReported then return nil end
record.recoveryReported = true
writeRecord(KEYS[1], record)
return record.deliveryRaw
`;

const BEGIN_RESET = `
-- delivery:begin-reset
local existing = redis.call("GET", KEYS[1])
if existing then return existing end
redis.call("SET", KEYS[1], ARGV[1], "EX", tonumber(ARGV[2]))
return ARGV[1]
`;

const COMMIT_RESET = `
-- delivery:commit-reset
if redis.call("GET", KEYS[5]) ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1], KEYS[3], KEYS[4])
redis.call("SREM", KEYS[6], ARGV[2])
redis.call("SREM", KEYS[7], ARGV[2])
-- What arrived during the reset survives it, and is re-advertised only if there
-- is actually something to claim.
local waiting = redis.call("LRANGE", KEYS[2], 0, -1)
for _, entry in ipairs(waiting) do redis.call("RPUSH", KEYS[1], entry) end
redis.call("DEL", KEYS[2], KEYS[5])
if #waiting > 0 then redis.call("SADD", KEYS[6], ARGV[2]) end
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
 * `accepted` carries its session after a colon — the one status with a payload,
 * kept in-band so the whole answer is one atomic read rather than a word plus a
 * follow-up lookup that could race.
 */
function readAdmission(raw: unknown, attempt: string): Admission {
  const [status = "", sessionId = ""] = z.string().safeParse(raw).data?.split(":", 2) ?? [];
  if (status === "start") return { status: "start", attempt };
  if (status === "accepted" && sessionId !== "") return { status: "accepted", sessionId };
  const known = z
    .enum(["in-progress", "recovery-required", "resetting", "stale"])
    .safeParse(status);
  return { status: known.success ? known.data : "stale" };
}

export class DeliveryWriter {
  private readonly redis: RedisClient;
  private readonly reader: DeliveryReader;

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.reader = new DeliveryReader(redis);
  }

  /**
   * Put a message on the queue, once.
   *
   * The dedupe set is the gate: a Discord id seen before returns without
   * queueing anything, which is the only reason a redelivered webhook does not
   * run a turn twice.
   *
   * The dispatch id is minted here rather than by the caller — it is the identity
   * every later fence compares against — and the render target is written in the
   * same step, because a delivery with nowhere to paint has nothing to say.
   */
  async enqueue(payload: MessagePayload): Promise<void> {
    const delivery: DeliveryPayload = { ...payload, dispatchId: crypto.randomUUID() };
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
        JSON.stringify(renderTargetFor(delivery)),
        RENDER_TTL_SECONDS,
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
        now,
        now + LeaseDuration.Handoff,
        queueMember(continuationKey),
        now + LeaseDuration.Turn,
        RECORD_TTL_MS,
      ],
    );
    if (raw === null || raw === undefined) return Result.ok(undefined);
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
    return evalFlag(
      this.redis,
      REFRESH_TURN,
      [activeKey(continuationKey)],
      [dispatchId, Date.now(), LeaseDuration.Turn],
    );
  }

  /** Record which eve session took the delivery. */
  async confirmSession(
    continuationKey: string,
    claimToken: string,
    sessionId: string,
  ): Promise<boolean> {
    return evalFlag(
      this.redis,
      CONFIRM_SESSION,
      [activeKey(continuationKey)],
      [claimToken, sessionId, Date.now()],
    );
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
    return evalFlag(this.redis, RELEASE_INGRESS, [activeKey(continuationKey)], [attempt]);
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
    switch (outcome) {
      case 1: {
        return "completed";
      }
      case -1: {
        return "stale";
      }
      case -2: {
        return "pending";
      }
      default: {
        return "missing";
      }
    }
  }

  /**
   * Give up on a turn that has gone quiet for a full lease, announcing it.
   *
   * Returns the delivery it abandoned so the caller can report it, or nothing
   * when the hold is still live. The record is read first because the intent key
   * has to be a `KEYS` entry, and only the record knows which dispatch it is.
   */
  async expire(
    continuationKey: string,
  ): Promise<Result<DeliveryPayload | undefined, InvalidInput>> {
    const dispatchId = (await this.reader.read(continuationKey))?.dispatchId;
    if (dispatchId === undefined) return Result.ok(undefined);
    return this.abandoned(
      EXPIRE,
      [
        activeKey(continuationKey),
        resetKey(continuationKey),
        renderIntentKey(dispatchId),
        AGENT_RENDER_READY_SET_KEY,
        parkedKey(continuationKey),
        pendingKey(continuationKey),
        QUEUE_INDEX_KEY,
        AGENT_READY_SET_KEY,
      ],
      [
        EXPIRY_TURN_ID,
        EXPIRY_TEXT,
        EXPIRY_FOOTER,
        Date.now(),
        queueMember(continuationKey),
        renderMember(dispatchId),
        RENDER_TTL_SECONDS,
      ],
    );
  }

  /** Report — once — a delivery that reached the agent and was never acknowledged. */
  async recover(
    continuationKey: string,
    dispatchId: string,
  ): Promise<Result<DeliveryPayload | undefined, InvalidInput>> {
    return this.abandoned(
      RECOVER,
      [
        activeKey(continuationKey),
        resetKey(continuationKey),
        renderIntentKey(dispatchId),
        AGENT_RENDER_READY_SET_KEY,
      ],
      [
        RECOVERY_TURN_ID,
        RECOVERY_TEXT,
        RECOVERY_FOOTER,
        renderMember(dispatchId),
        RENDER_TTL_SECONDS,
      ],
    );
  }

  /** Both bad endings answer with the delivery they gave up on, or nothing. */
  private async abandoned(
    script: string,
    keys: readonly string[],
    argv: readonly (string | number)[],
  ): Promise<Result<DeliveryPayload | undefined, InvalidInput>> {
    const raw: unknown = await this.redis.eval(script, [...keys], [...argv]);
    if (raw === null || raw === undefined) return Result.ok(undefined);
    return decodeDeliveryPayload(redisValue(raw));
  }

  /**
   * Install the reset barrier, or return the one already installed.
   *
   * Idempotent by returning the existing token: a retried reset must reuse the id
   * it started with, or the cutover it eventually performs would belong to a
   * different attempt than the one that stopped the traffic.
   */
  async beginReset(continuationKey: string): Promise<string> {
    const raw: unknown = await this.redis.eval(
      BEGIN_RESET,
      [resetKey(continuationKey)],
      [crypto.randomUUID(), RESET_BARRIER_TTL_SECONDS],
    );
    const owner = z.string().min(1).safeParse(raw);
    if (!owner.success) {
      throw new Transient({
        operation: "install the reset barrier",
        detail: "Redis returned no barrier token",
      });
    }
    return owner.data;
  }

  /**
   * Clear everything the reset replaces, then let what arrived meanwhile through.
   *
   * The shadow queue is the point: messages that landed during the reset are
   * moved back onto the real one rather than discarded, so a reset loses the
   * conversation's history without losing the person's words.
   */
  async commitReset(continuationKey: string, resetId: string): Promise<boolean> {
    return evalFlag(
      this.redis,
      COMMIT_RESET,
      [
        pendingKey(continuationKey),
        resetPendingKey(continuationKey),
        activeKey(continuationKey),
        parkedKey(continuationKey),
        resetKey(continuationKey),
        QUEUE_INDEX_KEY,
        AGENT_READY_SET_KEY,
      ],
      [resetId, queueMember(continuationKey)],
    );
  }
}
