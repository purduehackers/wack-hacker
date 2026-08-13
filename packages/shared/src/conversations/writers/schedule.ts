/**
 * The only thing that writes scheduled-occurrence receipts.
 *
 * A cron can fire the same occurrence twice — a retry, an overlapping tick, a
 * redeploy mid-fire — and running a scheduled task twice is visible to whoever
 * scheduled it. The occurrence id is stable across all of that, so the receipt
 * under it is what makes the second fire a no-op.
 *
 * The identity check is not paranoia. An occurrence id that comes back describing
 * a different schedule, owner, channel, or action means two schedules have
 * collided on one id, and quietly running one of them would run the wrong thing
 * in the wrong place.
 */

import { z } from "zod";

import { InvariantViolated } from "../../errors.ts";
import { jsonCodec } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import type { ScheduledFirePayload } from "../../wire.ts";
import { scheduledFireReceiptKey } from "../keys.ts";

/** Long enough to cover a fire in flight, short enough that a crash frees it. */
const CLAIM_TTL_MS = 2 * 60_000;
/** The accepted receipt outlives any plausible re-fire of the same occurrence. */
const RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * What makes two fires the same occurrence.
 *
 * Its own schema rather than a bare shape, so the type below is derived from the
 * thing that validates it instead of restated next to it.
 */
const identitySchema = z.object({
  scheduleId: z.uuid(),
  ownerId: z.string().min(1).max(32),
  channelId: z.string().min(1).max(32),
  actionType: z.string().min(1).max(64),
});

type OccurrenceIdentity = z.output<typeof identitySchema>;

const receiptSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("forwarding"),
    claimToken: z.string().min(1).max(128),
    ...identitySchema.shape,
  }),
  z.object({ status: z.literal("accepted"), ...identitySchema.shape }),
]);

const receiptCodec = jsonCodec(receiptSchema);

const CLAIM = `
-- schedule:claim
local raw = redis.call("GET", KEYS[1])
if raw then
  local current = cjson.decode(raw)
  if current.scheduleId ~= ARGV[1]
    or current.ownerId ~= ARGV[2]
    or current.channelId ~= ARGV[3]
    or current.actionType ~= ARGV[4]
  then
    return "conflict"
  end
  return current.status == "accepted" and "accepted" or "in-progress"
end
redis.call("SET", KEYS[1], ARGV[5], "PX", tonumber(ARGV[6]), "NX")
return "claimed"
`;

const COMPLETE = `
-- schedule:complete
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", tonumber(ARGV[3]))
return 1
`;

const RELEASE = `
-- schedule:release
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local current = cjson.decode(raw)
if current.status ~= "forwarding" or current.claimToken ~= ARGV[1] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

/** `accepted` means this occurrence already ran and must not run again. */
export type ScheduleClaim = "claimed" | "in-progress" | "accepted";

export class ScheduleWriter {
  private readonly redis: Pick<RedisClient, "eval">;

  constructor(redis: Pick<RedisClient, "eval">) {
    this.redis = redis;
  }

  /** Take the right to fire this occurrence, or say why not. */
  async claim(payload: ScheduledFirePayload, claimToken: string): Promise<ScheduleClaim> {
    const raw: unknown = await this.redis.eval(
      CLAIM,
      [scheduledFireReceiptKey(payload.occurrenceId)],
      [
        payload.scheduleId,
        payload.ownerId,
        payload.channelId,
        payload.actionType,
        z.encode(receiptCodec, { status: "forwarding", claimToken, ...identityOf(payload) }),
        CLAIM_TTL_MS,
      ],
    );
    if (raw === "conflict") {
      throw new InvariantViolated({
        invariant: "one occurrence id names one scheduled occurrence",
        detail: "its durable receipt describes a different schedule, owner, channel, or action",
      });
    }
    const known = z.enum(["claimed", "in-progress", "accepted"]).safeParse(raw);
    // Unrecognised reads as in-progress: refusing to fire is the safe answer when
    // the receipt cannot be understood, since the alternative is firing twice.
    return known.success ? known.data : "in-progress";
  }

  /** Record that the occurrence ran, so a re-fire is refused for good. */
  async complete(payload: ScheduledFirePayload, claimToken: string): Promise<boolean> {
    const completed = await this.redis.eval(
      COMPLETE,
      [scheduledFireReceiptKey(payload.occurrenceId)],
      [
        claimToken,
        z.encode(receiptCodec, { status: "accepted", ...identityOf(payload) }),
        RECEIPT_TTL_SECONDS,
      ],
    );
    return Number(completed) === 1;
  }

  /** Give the claim back after a fire that failed, so a retry can take it. */
  async release(occurrenceId: string, claimToken: string): Promise<boolean> {
    const released = await this.redis.eval(
      RELEASE,
      [scheduledFireReceiptKey(occurrenceId)],
      [claimToken],
    );
    return Number(released) === 1;
  }
}

function identityOf(payload: ScheduledFirePayload): OccurrenceIdentity {
  return {
    scheduleId: payload.scheduleId,
    ownerId: payload.ownerId,
    channelId: payload.channelId,
    actionType: payload.actionType,
  };
}
