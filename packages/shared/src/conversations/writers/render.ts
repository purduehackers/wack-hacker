/**
 * The only thing that writes the render aggregate.
 *
 * Both directions live here because they are one record seen from two sides: the
 * agent publishes what it wants shown, the bot paints it and records what landed.
 * Splitting them by process would put the revision fence — the single rule that
 * makes the two safe to run concurrently — in two files.
 *
 * Painting Discord is not atomic. It is several HTTP calls, any of which can fail
 * or be overtaken, so a paint holds a lease and checkpoints after every externally
 * visible change. If the process dies mid-paint the lease lapses and the next
 * sweep picks the dispatch up with a projection describing exactly how far it
 * got, which is what stops a retry duplicating messages.
 *
 * Two methods here also write the delivery record, through the same `writeRecord`
 * the delivery writer uses. That is deliberate rather than a layering slip:
 * publishing a render is the only signal frequent enough to prove a turn is alive,
 * and parking is one transition that ends the turn and fixes the final frame. Split
 * across two round trips, either could half-happen.
 */

import { z } from "zod";

import type { RedisClient } from "../../redis/client.ts";
import type { ParkedPayload, RenderIntent } from "../../wire.ts";
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
import { LeaseDuration } from "../lease.ts";
import { DELIVERY_RECORD_LUA } from "../records/delivery.ts";
import type { RenderProjection, StoredRenderProjection } from "../records/render.ts";
import { projectionCodec } from "../records/render.ts";

/** Long enough that a thread reopened next week still shows what was said. */
const RENDER_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Say what should be on screen, and prove the turn is still alive doing it.
 *
 * Fenced on the revision: a lower one is a straggler and is dropped, and the same
 * one with different content is a bug in the publisher rather than a race, so it
 * is refused loudly instead of silently picking a winner. A terminal intent may
 * overwrite a streaming one at the same revision, never the reverse.
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
  if decoded.phase ~= "streaming" and ARGV[5] == "streaming" then return 0 end
  if tonumber(decoded.revision) > tonumber(ARGV[1]) then return 0 end
  if tonumber(decoded.revision) == tonumber(ARGV[1]) then
    if current == ARGV[2] then return 2 end
    return -2
  end
end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[4]))
-- Proof of life. The turn holds its conversation for as long as it keeps
-- painting, and no longer.
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
 * after a publish it never recorded, so a terminal intent has to fence above what
 * Redis holds rather than above what the agent remembers — otherwise it lands at a
 * revision the last streaming frame already used and is rejected as a reuse.
 * Returns the revision it actually settled at, which the caller needs because it
 * may not be the one it asked for.
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
redis.call("SET", KEYS[2], ARGV[4])
redis.call("SADD", KEYS[3], ARGV[6])
return settledRevision
`;

/**
 * Take the lease if nobody holds it.
 *
 * `SET NX PX` is the whole transition, so this needs no script at all beyond
 * turning Redis's nil-or-OK into a number. What it replaces opened with a branch
 * for "the caller already holds this, so renew" — unreachable, because the token
 * is minted per call and so never matches what is stored. A holder wanting to
 * hold on calls `renew`, which is what that branch was reaching for.
 */
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
 * Record progress without giving up the lease.
 *
 * Called after every mutation Discord can see, so that a crash leaves a
 * projection matching the channel rather than one predating the last message
 * posted.
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
 * records an outcome, because that outcome is what releases the delivery, and
 * releasing on a half-painted turn strands everything queued behind it.
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
 * Give up on a paint that can never land.
 *
 * A message someone deleted, or a 4xx that will not improve on retry. Intent,
 * target and projection are bounded rather than deleted so a late reader can still
 * see what was attempted; the outcome is what lets the delivery go.
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
 * `accepted` is whether the intent is now the desired state; `shouldWake` is
 * whether anyone needs telling. They differ when the dispatch was already
 * advertised, where waking again would only add a redundant pass.
 */
export interface RenderPublication {
  readonly accepted: boolean;
  readonly shouldWake: boolean;
}

export class RenderWriter {
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  /** Agent side: say what should be on screen. */
  async publish(intent: RenderIntent): Promise<RenderPublication> {
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
          LeaseDuration.Turn,
        ],
      ),
    );
    if (outcome === -2) throw new Error("render revision was reused with different content");
    return { accepted: outcome !== 0, shouldWake: outcome !== 0 && outcome !== 3 };
  }

  /**
   * Agent side: fix the final frame and hand the conversation to a person.
   *
   * Returns the revision it settled at, or nothing if the record had moved on.
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
        ],
      ),
    );
    if (outcome === -2) {
      throw new Error("terminal render revision was reused with different content");
    }
    return outcome > 0 ? outcome : undefined;
  }

  /** Bot side: take the paint lease, or renew one this caller already holds. */
  async claim(dispatchId: string): Promise<string | undefined> {
    const token = crypto.randomUUID();
    const acquired = await this.redis.eval(
      CLAIM,
      [renderClaimKey(dispatchId)],
      [token, LeaseDuration.Paint],
    );
    return Number(acquired) === 1 ? token : undefined;
  }

  /** Still holding it? The renderer asks before every Discord write. */
  async renew(dispatchId: string, claimToken: string): Promise<boolean> {
    const renewed = await this.redis.eval(
      RENEW,
      [renderClaimKey(dispatchId)],
      [claimToken, LeaseDuration.Paint],
    );
    return Number(renewed) === 1;
  }

  /** Record what is now on screen, keeping the lease. */
  async checkpoint(
    dispatchId: string,
    claimToken: string,
    projection: RenderProjection,
    appliedRevision: number,
  ): Promise<boolean> {
    const saved = await this.redis.eval(
      CHECKPOINT,
      [renderClaimKey(dispatchId), renderProjectionKey(dispatchId)],
      [
        claimToken,
        z.encode(projectionCodec, stamped(projection, appliedRevision)),
        RENDER_TTL_SECONDS,
        LeaseDuration.Paint,
      ],
    );
    return Number(saved) === 1;
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
          z.encode(projectionCodec, stamped(projection, appliedRevision)),
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
    const released = await this.redis.eval(RELEASE, [renderClaimKey(dispatchId)], [claimToken]);
    return Number(released) === 1;
  }

  /** Record that this dispatch can never be painted. */
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

/** `appliedRevision` is stamped at write time, never carried by the caller. */
function stamped(projection: RenderProjection, appliedRevision: number): StoredRenderProjection {
  return { ...projection, appliedRevision };
}
