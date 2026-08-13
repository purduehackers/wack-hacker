/**
 * The only thing that writes the HITL claim.
 *
 * One question, one answerer. Two people can see the same buttons — that is the
 * point of rendering them in a channel — so the first click wins and the rest are
 * told the question is taken, rather than every click forwarding an answer.
 *
 * Fenced on the render revision rather than the request id, because a turn can
 * ask again: a new revision supersedes the claim on the old one, which is what
 * lets an approval follow the question it came out of.
 */

import { z } from "zod";

import { jsonCodec } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import { evalFlag } from "../io.ts";
import { hitlClaimKey, renderIntentKey, resetKey } from "../keys.ts";

/** Outlives any plausible retry of the click that took it, and no longer. */
const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

const hitlClaimSchema = z.object({
  revision: z.int().positive(),
  requestId: z.string().min(1).max(128),
  interactionId: z.string().min(1).max(32),
  status: z.enum(["forwarding", "accepted"]),
});

const claimCodec = jsonCodec(hitlClaimSchema);

const CLAIM = `
-- hitl:claim
if redis.call("GET", KEYS[3]) then return "stale" end
local raw = redis.call("GET", KEYS[1])
if not raw then return "stale" end
local intent = cjson.decode(raw)
if intent.phase ~= "streaming" or tonumber(intent.revision) ~= tonumber(ARGV[1]) then return "stale" end
if intent.continuationKey ~= ARGV[7] then return "stale" end
local requests = intent.inputRequests
local request = requests and requests[tonumber(ARGV[2]) + 1]
if not request then return "stale" end
if request.requestId ~= ARGV[3] or request.recipientUserId ~= ARGV[4] then return "stale" end

local existing = redis.call("GET", KEYS[2])
-- A claim on an older revision does not hold: the question it answered is gone.
if existing and tonumber(cjson.decode(existing).revision) >= tonumber(ARGV[1]) then
  return "taken"
end
redis.call("SET", KEYS[2], ARGV[5], "EX", tonumber(ARGV[6]))
return "acquired"
`;

const ACCEPT = `
-- hitl:accept
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local claim = cjson.decode(raw)
if claim.interactionId ~= ARGV[1] or tonumber(claim.revision) ~= tonumber(ARGV[2]) then
  return 0
end
claim.status = "accepted"
redis.call("SET", KEYS[1], cjson.encode(claim), "EX", tonumber(ARGV[3]))
return 1
`;

export interface HitlClaimInput {
  readonly dispatchId: string;
  readonly continuationKey: string;
  readonly revision: number;
  readonly requestIndex: number;
  readonly requestId: string;
  readonly recipientUserId: string;
  readonly interactionId: string;
}

/** `taken` means somebody else got there first; `stale` means the question moved on. */
export type HitlClaim = "acquired" | "taken" | "stale";

export class HitlWriter {
  private readonly redis: Pick<RedisClient, "eval">;

  constructor(redis: Pick<RedisClient, "eval">) {
    this.redis = redis;
  }

  /** Take the right to answer this question, or say why not. */
  async claim(input: HitlClaimInput): Promise<HitlClaim> {
    const raw: unknown = await this.redis.eval(
      CLAIM,
      [
        renderIntentKey(input.dispatchId),
        hitlClaimKey(input.dispatchId),
        resetKey(input.continuationKey),
      ],
      [
        input.revision,
        input.requestIndex,
        input.requestId,
        input.recipientUserId,
        z.encode(claimCodec, {
          revision: input.revision,
          requestId: input.requestId,
          interactionId: input.interactionId,
          status: "forwarding",
        }),
        CLAIM_TTL_SECONDS,
        input.continuationKey,
      ],
    );
    const known = z.enum(["acquired", "taken", "stale"]).safeParse(raw);
    return known.success ? known.data : "stale";
  }

  /** Mark the claim answered, once eve has taken the response. */
  async accept(dispatchId: string, revision: number, interactionId: string): Promise<boolean> {
    return evalFlag(
      this.redis,
      ACCEPT,
      [hitlClaimKey(dispatchId)],
      [interactionId, revision, CLAIM_TTL_SECONDS],
    );
  }
}
