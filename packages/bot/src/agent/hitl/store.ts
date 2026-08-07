import type { RedisClient } from "@repo/shared/redis";
import { agentResetKey, hitlClaimKey, renderIntentKey } from "@repo/shared/wire";

const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

const CLAIM_SCRIPT = `
if redis.call("GET", KEYS[3]) then return -1 end
local raw = redis.call("GET", KEYS[1])
if not raw then return -1 end
local intent = cjson.decode(raw)
if intent.phase ~= "streaming" or tonumber(intent.revision) ~= tonumber(ARGV[1]) then return -1 end
if intent.continuationKey ~= ARGV[7] then return -1 end
local requests = intent.inputRequests
local request = requests and requests[tonumber(ARGV[2]) + 1]
if not request then return -1 end
if request.requestId ~= ARGV[3] or request.recipientUserId ~= ARGV[4] then return -1 end

local existing = redis.call("GET", KEYS[2])
if existing then
  local claim = cjson.decode(existing)
  if tonumber(claim.revision) >= tonumber(ARGV[1]) then return 0 end
end
redis.call("SET", KEYS[2], ARGV[5], "EX", tonumber(ARGV[6]))
return 1
`;

const COMPLETE_SCRIPT = `
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

interface HitlClaimRecord {
  readonly revision: number;
  readonly requestId: string;
  readonly interactionId: string;
  readonly status: "forwarding" | "accepted";
}

export function createHitlStore(redis: Pick<RedisClient, "eval">) {
  return {
    claim: async (input: HitlClaimInput): Promise<"acquired" | "claimed" | "stale"> => {
      const record: HitlClaimRecord = {
        revision: input.revision,
        requestId: input.requestId,
        interactionId: input.interactionId,
        status: "forwarding",
      };
      const outcome = Number(
        await redis.eval(
          CLAIM_SCRIPT,
          [
            renderIntentKey(input.dispatchId),
            hitlClaimKey(input.dispatchId),
            agentResetKey(input.continuationKey),
          ],
          [
            input.revision,
            input.requestIndex,
            input.requestId,
            input.recipientUserId,
            JSON.stringify(record),
            CLAIM_TTL_SECONDS,
            input.continuationKey,
          ],
        ),
      );
      return outcome === 1 ? "acquired" : outcome === 0 ? "claimed" : "stale";
    },

    complete: async (
      dispatchId: string,
      revision: number,
      interactionId: string,
    ): Promise<boolean> =>
      Number(
        await redis.eval(
          COMPLETE_SCRIPT,
          [hitlClaimKey(dispatchId)],
          [interactionId, revision, CLAIM_TTL_SECONDS],
        ),
      ) === 1,
  };
}

export type HitlStore = ReturnType<typeof createHitlStore>;
