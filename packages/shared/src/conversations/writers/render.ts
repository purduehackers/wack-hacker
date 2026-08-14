/**
 * The only thing that writes the render aggregate.
 *
 * Both directions live here because they are one record seen from two sides.
 * The agent publishes what it wants shown. The bot paints it and records what
 * landed. Splitting them by process would put the revision fence, the one rule
 * making them safe to run concurrently, in two files.
 *
 * Painting Discord is not atomic: several HTTP calls, any of which can fail or be
 * overtaken. So a paint holds a lease and checkpoints after every externally
 * visible change. A process dying mid-paint then leaves a projection describing
 * exactly how far it got, which is what stops a retry duplicating messages.
 *
 * `publish` and `settleAndPark` also write the delivery record, through the same
 * `writeRecord` the delivery writer uses. Deliberate rather than a layering slip:
 * publishing is the only signal frequent enough to prove a turn is alive. Parking
 * both ends the turn and fixes the final frame — split across two round trips,
 * either could half-happen.
 */

import { z } from "zod";

import type { RedisClient } from "../../redis/client.ts";
import type { ParkedPayload, RenderIntent } from "../../wire.ts";
import { evalFlag } from "../io.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  queueMember,
  renderClaimKey,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
} from "../keys.ts";
import { LeaseDuration, RECORD_TTL_MS } from "../lease.ts";
import { DELIVERY_RECORD_LUA } from "../records/delivery.ts";
import type { RenderProjection } from "../records/render.ts";
import { projectionCodec, RENDER_TTL_SECONDS } from "../records/render.ts";

/**
 * Say what should be on screen, and prove the turn is still alive doing it.
 *
 * Fenced on the revision: a lower one is a straggler, which the script drops.
 * The same one with different content is a bug in the publisher rather than a
 * race. The script refuses that loudly instead of silently picking a winner.
 *
 * The equal-revision branch is phase-blind — it refuses a terminal frame
 * arriving at a revision a streaming frame already used, like any other reuse.
 * That case is real, because agent state can crash after a publish it never
 * recorded. `settleAndPark` is what handles it: it bumps the revision rather
 * than colliding. The one thing phase decides here is the reverse, above: a
 * streaming frame may never overwrite a settled one.
 */
const PUBLISH = `
${DELIVERY_RECORD_LUA}
-- render:publish
local raw = redis.call("GET", KEYS[3])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.dispatchId ~= ARGV[6] or record.messageId ~= ARGV[7] then return 0 end
if record.phase ~= "live" then return 0 end
local current = redis.call("GET", KEYS[1])
if current then
  local decoded = cjson.decode(current)
  -- The one thing phase decides: a streaming frame may never overwrite a settled
  -- one, whatever the revisions say.
  if decoded.phase ~= "streaming" and ARGV[5] == "streaming" then return 0 end
  local stored = tonumber(decoded.revision)
  local wanted = tonumber(ARGV[1])
  if stored == wanted and current == ARGV[2] then return 2 end
  -- Otherwise the publisher's counter is behind what Redis holds. Answered with
  -- the stored revision, negated, so it can resync — refusing instead wedges the
  -- turn permanently, because the counter only advances on a publish that lands
  -- and every retry then re-attempts the same rejected number.
  if stored >= wanted then return -stored end
end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[4]))
-- Proof of life. The turn holds its conversation for as long as it keeps
-- painting, and no longer — except while it is waiting on a person, when the
-- caller sends the longer duration because nothing will paint until they answer.
record.turn.expiresAtMs = tonumber(ARGV[8]) + tonumber(ARGV[9])
writeRecord(KEYS[3], record)
-- A new frame invalidates whatever the last one settled on.
redis.call("DEL", KEYS[4])
if redis.call("SADD", KEYS[2], ARGV[3]) == 1 then return 1 end
return 3
`;

/**
 * Fix the final frame and hand the conversation to a person, atomically.
 *
 * The revision arithmetic is the subtle part. The agent's own state can crash
 * after a publish it never recorded. So a terminal intent has to fence above
 * what Redis holds rather than above what the agent remembers. Otherwise it
 * lands at a revision the last streaming frame already used, and the fence
 * rejects it as a reuse. Returns the revision it actually settled at, which the
 * caller needs because it may not be the one it asked for.
 */
const SETTLE_AND_PARK = `
${DELIVERY_RECORD_LUA}
-- render:settle-and-park
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local record = cjson.decode(raw)
if record.dispatchId ~= ARGV[1] or record.messageId ~= ARGV[2] then return -1 end
if record.phase ~= "live" and record.phase ~= "parked" then return -1 end
if record.sessionId ~= "" and record.sessionId ~= ARGV[3] then return -1 end
if record.phase == "parked" and record.eveTurnId and record.eveTurnId ~= ARGV[5] then return -1 end

local requestedRevision = tonumber(ARGV[7])
local settledRevision = requestedRevision
local desired = redis.call("GET", KEYS[4])
if desired then
  local decoded = cjson.decode(desired)
  local currentRevision = tonumber(decoded.revision)
  if decoded.phase == "streaming" then
    if currentRevision >= requestedRevision then
      settledRevision = currentRevision + 1
      local terminal = cjson.decode(ARGV[8])
      terminal.revision = settledRevision
      redis.call("SET", KEYS[4], cjson.encode(terminal), "EX", tonumber(ARGV[10]))
    else
      redis.call("SET", KEYS[4], ARGV[8], "EX", tonumber(ARGV[10]))
    end
  elseif currentRevision < requestedRevision then
    redis.call("SET", KEYS[4], ARGV[8], "EX", tonumber(ARGV[10]))
  elseif currentRevision == requestedRevision then
    if desired ~= ARGV[8] then return -2 end
  else
    settledRevision = currentRevision
  end
else
  redis.call("SET", KEYS[4], ARGV[8], "EX", tonumber(ARGV[10]))
end
redis.call("DEL", KEYS[6])
redis.call("SADD", KEYS[5], ARGV[9])

record.phase = "parked"
record.sessionId = ARGV[3]
record.eveTurnId = ARGV[5]
record.turn.expiresAtMs = tonumber(ARGV[11]) + tonumber(ARGV[12])
writeRecord(KEYS[1], record)
-- Bounded by the record it fences against: a marker outliving its record is
-- invariant I5, unusable and uncollectable at once.
redis.call("SET", KEYS[2], ARGV[4], "PX", tonumber(ARGV[13]))
redis.call("SADD", KEYS[3], ARGV[6])
return settledRevision
`;

/** `SET NX PX` is the whole transition. A holder wanting to hold on calls `renew`. */
const CLAIM = `
-- render:claim
if redis.call("SET", KEYS[1], ARGV[1], "PX", tonumber(ARGV[2]), "NX") then return 1 end
return 0
`;

const RENEW = `
-- render:renew
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
return 1
`;

/**
 * Record progress without giving up the lease, after every mutation Discord can
 * see. A crash then leaves a projection matching the channel rather than one
 * predating the last message posted.
 */
const CHECKPOINT = `
-- render:checkpoint
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[3]))
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[4]))
return 1
`;

/**
 * Finish the paint, and say whether it caught up.
 *
 * A paint that lands behind the current intent is not finished: the dispatch stays
 * advertised so the sweep drains the rest. Only a terminal paint that caught up
 * records an outcome, because that outcome is what releases the delivery.
 * Releasing on a half-painted turn strands everything queued behind it.
 */
const COMPLETE = `
-- render:complete
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[5]))
redis.call("DEL", KEYS[1])
local current = redis.call("GET", KEYS[3])
if current and tonumber(cjson.decode(current).revision) > tonumber(ARGV[3]) then return 2 end
redis.call("SREM", KEYS[4], ARGV[4])
if ARGV[6] == "1" then
  redis.call("EXPIRE", KEYS[5], tonumber(ARGV[5]))
  redis.call("SET", KEYS[6], "applied", "EX", tonumber(ARGV[5]))
end
return 1
`;

const RELEASE = `
-- render:release
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`;

/**
 * Give up on a paint that can never land — a deleted message, or a 4xx that will
 * not improve on retry. The script bounds intent, target and projection rather
 * than deleting them, so a late reader can still see the attempt.
 */
const DISCARD = `
-- render:discard
redis.call("SREM", KEYS[1], ARGV[1])
for index = 2, 4 do
  if redis.call("EXISTS", KEYS[index]) == 1 then
    redis.call("EXPIRE", KEYS[index], tonumber(ARGV[2]))
  end
end
redis.call("SET", KEYS[5], "discarded", "EX", tonumber(ARGV[2]))
return 1
`;

/** Whether the paint finished, was overtaken, or lost its lease. */
export type PaintResult = "caught-up" | "newer" | "lost";

export interface PaintCompletion {
  readonly dispatchId: string;
  readonly claimToken: string;
  readonly projection: RenderProjection;
  readonly appliedRevision: number;
  readonly terminal: boolean;
}

/**
 * `accepted` is whether the intent is now the desired state. `shouldWake` is
 * whether anyone needs telling. They differ when the dispatch was already
 * advertised, where waking again would only add a redundant pass.
 *
 * The writer sets `behindRevision` when Redis refuses the publish because it
 * already holds that revision or a later one. It carries what Redis holds. A
 * caller whose own counter fell behind can then resync and try again rather
 * than retrying the same rejected number forever.
 */
export interface RenderPublication {
  readonly accepted: boolean;
  readonly shouldWake: boolean;
  readonly behindRevision?: number;
}

/**
 * Single writer over the render aggregate, for both processes. Each method runs
 * one Lua script, so every transition is atomic and fenced. Agent-side intents
 * fence on the revision, bot-side paints on the claim token.
 */
export class RenderWriter {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /** Agent side: say what should be on screen. */
  async publish(intent: RenderIntent): Promise<RenderPublication> {
    // A turn showing buttons waits on a person, and it deliberately does
    // not park — an input request is a resumption of this turn, not a boundary
    // where an unrelated queued message may enter. So nothing refreshes its hold
    // until the answer arrives, and on the ordinary turn lease the sweep expired
    // it after thirty minutes and printed "it went quiet for too long" over a
    // question the person was still reading. Waiting on someone is what the
    // person lease is for.
    const waitingOnPerson =
      (intent.inputRequests?.length ?? 0) > 0 || (intent.authorizations?.length ?? 0) > 0;
    const outcome = Number(
      await this.redis.eval(
        PUBLISH,
        [
          renderIntentKey(intent.dispatchId),
          AGENT_RENDER_READY_SET_KEY,
          activeKey(intent.continuationKey),
          renderOutcomeKey(intent.dispatchId),
        ],
        [
          intent.revision,
          JSON.stringify(intent),
          renderMember(intent.dispatchId),
          RENDER_TTL_SECONDS,
          intent.phase,
          intent.dispatchId,
          intent.messageId,
          Date.now(),
          waitingOnPerson ? LeaseDuration.Person : LeaseDuration.Turn,
        ],
      ),
    );
    if (outcome < 0) return { accepted: false, shouldWake: false, behindRevision: -outcome };
    return { accepted: outcome !== 0, shouldWake: outcome === 1 || outcome === 2 };
  }

  /**
   * Agent side: fix the final frame and hand the conversation to a person.
   *
   * Returns the revision it settled at, or nothing if the record moved on.
   */
  async settleAndPark(intent: RenderIntent, parked: ParkedPayload): Promise<number | undefined> {
    if (intent.phase === "streaming") throw new Error("cannot settle a streaming render intent");
    const outcome = Number(
      await this.redis.eval(
        SETTLE_AND_PARK,
        [
          activeKey(parked.continuationKey),
          parkedKey(parked.continuationKey),
          AGENT_READY_SET_KEY,
          renderIntentKey(intent.dispatchId),
          AGENT_RENDER_READY_SET_KEY,
          renderOutcomeKey(intent.dispatchId),
        ],
        [
          parked.dispatchId,
          parked.messageId,
          parked.sessionId,
          JSON.stringify(parked),
          parked.eveTurnId,
          queueMember(parked.continuationKey),
          intent.revision,
          JSON.stringify(intent),
          renderMember(intent.dispatchId),
          RENDER_TTL_SECONDS,
          Date.now(),
          LeaseDuration.Person,
          RECORD_TTL_MS,
        ],
      ),
    );
    if (outcome === -2) {
      throw new Error("terminal render revision was reused with different content");
    }
    return outcome > 0 ? outcome : undefined;
  }

  /** Bot side: take the paint lease if nobody holds it. */
  async claim(dispatchId: string): Promise<string | undefined> {
    const token = crypto.randomUUID();
    const acquired = await evalFlag(
      this.redis,
      CLAIM,
      [renderClaimKey(dispatchId)],
      [token, LeaseDuration.Paint],
    );
    return acquired ? token : undefined;
  }

  /** Still holding it? The renderer asks before every Discord write. */
  async renew(dispatchId: string, claimToken: string): Promise<boolean> {
    return evalFlag(
      this.redis,
      RENEW,
      [renderClaimKey(dispatchId)],
      [claimToken, LeaseDuration.Paint],
    );
  }

  /** Record what is now on screen, keeping the lease. */
  async checkpoint(
    dispatchId: string,
    claimToken: string,
    projection: RenderProjection,
    appliedRevision: number,
  ): Promise<boolean> {
    return evalFlag(
      this.redis,
      CHECKPOINT,
      [renderClaimKey(dispatchId), renderProjectionKey(dispatchId)],
      [
        claimToken,
        encodeProjection(projection, appliedRevision),
        RENDER_TTL_SECONDS,
        LeaseDuration.Paint,
      ],
    );
  }

  /** Give the lease back, recording where the paint got to. */
  async complete(completion: PaintCompletion): Promise<PaintResult> {
    const { dispatchId, claimToken, projection, appliedRevision, terminal } = completion;
    const outcome = Number(
      await this.redis.eval(
        COMPLETE,
        [
          renderClaimKey(dispatchId),
          renderProjectionKey(dispatchId),
          renderIntentKey(dispatchId),
          AGENT_RENDER_READY_SET_KEY,
          renderTargetKey(dispatchId),
          renderOutcomeKey(dispatchId),
        ],
        [
          claimToken,
          encodeProjection(projection, appliedRevision),
          appliedRevision,
          renderMember(dispatchId),
          RENDER_TTL_SECONDS,
          Number(terminal),
        ],
      ),
    );
    if (outcome === 1) return "caught-up";
    return outcome === 2 ? "newer" : "lost";
  }

  /** Drop the lease without finishing, so the sweep can pick it up again. */
  async release(dispatchId: string, claimToken: string): Promise<boolean> {
    return evalFlag(this.redis, RELEASE, [renderClaimKey(dispatchId)], [claimToken]);
  }

  /** Record that nothing can ever paint this dispatch. */
  async discard(dispatchId: string): Promise<void> {
    await this.redis.eval(
      DISCARD,
      [
        AGENT_RENDER_READY_SET_KEY,
        renderIntentKey(dispatchId),
        renderTargetKey(dispatchId),
        renderProjectionKey(dispatchId),
        renderOutcomeKey(dispatchId),
      ],
      [renderMember(dispatchId), RENDER_TTL_SECONDS],
    );
  }
}

/** The writer stamps `appliedRevision` at write time. The caller never carries it. */
function encodeProjection(projection: RenderProjection, appliedRevision: number): string {
  return z.encode(projectionCodec, { ...projection, appliedRevision });
}
