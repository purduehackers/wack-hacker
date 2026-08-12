/** Redis desired-state inbox and durable bot-owned Discord projection. */

import { z } from "zod";

import { InvalidInput } from "../errors.ts";
import { contentHash, discordSnowflake } from "../formats.ts";
import { jsonCodec, stored } from "../json.ts";
import type { RedisClient } from "../redis/client.ts";
import { Result } from "../result/index.ts";
import { decodeAuthorizationChallenge, decodeRenderIntent, decodeRenderTarget } from "../wire.ts";
import type { AuthorizationChallenge, RenderIntent, RenderTarget } from "../wire.ts";
import {
  AGENT_RENDER_READY_SET_KEY,
  authorizationChallengeKey,
  dispatchIdFromRenderMember,
  renderClaimKey,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
  renderProjectionKey,
  renderTargetKey,
} from "./keys.ts";
const renderProjectionSchema = z.object({
  anchorMessageId: discordSnowflake.optional(),
  anchorContentHash: contentHash.optional(),
  /**
   * The message carrying an input request's prose and buttons.
   *
   * Separate from the anchor because the anchor is edited on every streaming
   * tick, and Discord does not notify anyone for an edit — a mention added that
   * way never pings the person being asked for input. Optional so a projection
   * written before this existed still decodes.
   */
  hitlMessageId: discordSnowflake.optional(),
  hitlContentHash: contentHash.optional(),
  /**
   * Which request `hitlMessageId` is asking about.
   *
   * A turn can ask more than once — an input request, then a tool approval for
   * what the answer led to. Without an identity here the second question would
   * be edited over the first, and the record of what was already answered would
   * be lost. A change in this value means "post a new message", not "edit".
   */
  hitlRequestKey: z.string().min(1).max(128).optional(),
  overflow: z
    .array(z.object({ messageId: discordSnowflake, contentHash: contentHash.optional() }))
    .max(10),
  appliedRevision: z.int().nonnegative(),
});

/**
 * One declaration owns both directions of the projection round trip, so the
 * record can no longer be written in a shape its own reader rejects — a bad
 * message id now fails at the write instead of poisoning the key until the
 * next read.
 */
const projectionCodec = jsonCodec(renderProjectionSchema);

type StoredRenderProjection = z.output<typeof renderProjectionSchema>;

/** What the bot has painted. `appliedRevision` is stamped on at write time. */
type RenderProjection = Omit<StoredRenderProjection, "appliedRevision">;

const CLAIM_TTL_MS = 45_000;
const PROJECTION_TTL_SECONDS = 7 * 24 * 60 * 60;

const CLAIM_SCRIPT = `
-- wack:claim-render
local current = redis.call("GET", KEYS[1])
if current == ARGV[1] then
  redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
  return 1
end
if current then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "PX", tonumber(ARGV[2]))
return 1
`;

const RENEW_SCRIPT = `
-- wack:renew-render
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[2]))
return 1
`;

const CHECKPOINT_SCRIPT = `
-- wack:checkpoint-render
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[3]))
redis.call("PEXPIRE", KEYS[1], tonumber(ARGV[4]))
return 1
`;

const COMPLETE_SCRIPT = `
-- wack:complete-render
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2], "EX", tonumber(ARGV[5]))
redis.call("DEL", KEYS[1])
local current = redis.call("GET", KEYS[3])
if not current then
  redis.call("SREM", KEYS[4], ARGV[4])
  if ARGV[6] == "1" then
    redis.call("EXPIRE", KEYS[5], tonumber(ARGV[5]))
    redis.call("SET", KEYS[6], "applied", "EX", tonumber(ARGV[5]))
  end
  return 1
end
local intent = cjson.decode(current)
if tonumber(intent.revision) <= tonumber(ARGV[3]) then
  redis.call("SREM", KEYS[4], ARGV[4])
  if ARGV[6] == "1" then
    redis.call("EXPIRE", KEYS[5], tonumber(ARGV[5]))
    redis.call("SET", KEYS[6], "applied", "EX", tonumber(ARGV[5]))
  end
  return 1
end
return 2
`;

const RELEASE_SCRIPT = `
-- wack:release-render
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`;

const DISCARD_SCRIPT = `
-- wack:discard-render
redis.call("SREM", KEYS[1], ARGV[1])
for index = 2, 4 do
  if redis.call("EXISTS", KEYS[index]) == 1 then
    redis.call("EXPIRE", KEYS[index], tonumber(ARGV[2]))
  end
end
redis.call("SET", KEYS[5], "discarded", "EX", tonumber(ARGV[2]))
return 1
`;

function decodeProjection(raw: unknown): Result<StoredRenderProjection, InvalidInput> {
  const parsed = stored(renderProjectionSchema).safeParse(raw);
  return parsed.success
    ? Result.ok(parsed.data)
    : Result.err(
        new InvalidInput({
          subject: "render projection",
          issues: parsed.error.issues.map(({ message, path }) => `${path.join(".")}: ${message}`),
        }),
      );
}

function renderIds(values: readonly string[]): readonly string[] {
  return values.flatMap((candidate) => {
    const dispatchId = dispatchIdFromRenderMember(candidate);
    return dispatchId === undefined ? [] : [dispatchId];
  });
}

function storedProjection(
  projection: RenderProjection,
  appliedRevision: number,
): StoredRenderProjection {
  return { ...projection, appliedRevision };
}

async function readOptional<T>(
  redis: RedisClient,
  key: string,
  decode: (raw: unknown) => Result<T, InvalidInput>,
): Promise<Result<T | undefined, InvalidInput>> {
  const raw: unknown = await redis.get(key);
  return raw === null || raw === undefined ? Result.ok(undefined) : decode(raw);
}

async function readProjection(
  redis: RedisClient,
  dispatchId: string,
  anchorMessageId?: string,
): Promise<Result<StoredRenderProjection, InvalidInput>> {
  const raw: unknown = await redis.get(renderProjectionKey(dispatchId));
  if (raw === null || raw === undefined) {
    return Result.ok({
      ...(anchorMessageId === undefined ? {} : { anchorMessageId }),
      overflow: [],
      appliedRevision: 0,
    });
  }
  return decodeProjection(raw);
}

interface RenderCompletion {
  readonly dispatchId: string;
  readonly claimToken: string;
  readonly projection: RenderProjection;
  readonly appliedRevision: number;
  readonly terminal: boolean;
}

async function completeRender(
  redis: RedisClient,
  completion: RenderCompletion,
): Promise<"caught-up" | "newer" | "lost"> {
  const { dispatchId, claimToken, projection, appliedRevision, terminal } = completion;
  const outcome = Number(
    await redis.eval(
      COMPLETE_SCRIPT,
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
        z.encode(projectionCodec, storedProjection(projection, appliedRevision)),
        appliedRevision,
        renderMember(dispatchId),
        PROJECTION_TTL_SECONDS,
        Number(terminal),
      ],
    ),
  );
  if (outcome === 1) return "caught-up";
  if (outcome === 2) return "newer";
  return "lost";
}

export function createRenderTransitions(redis: RedisClient) {
  return {
    claim: async (dispatchId: string): Promise<string | undefined> => {
      const token = crypto.randomUUID();
      const claimed = Number(
        await redis.eval(CLAIM_SCRIPT, [renderClaimKey(dispatchId)], [token, CLAIM_TTL_MS]),
      );
      return claimed === 1 ? token : undefined;
    },

    renew: async (dispatchId: string, claimToken: string): Promise<boolean> =>
      Number(
        await redis.eval(RENEW_SCRIPT, [renderClaimKey(dispatchId)], [claimToken, CLAIM_TTL_MS]),
      ) === 1,

    intent: (dispatchId: string): Promise<Result<RenderIntent | undefined, InvalidInput>> =>
      readOptional(redis, renderIntentKey(dispatchId), decodeRenderIntent),

    authorization: (
      dispatchId: string,
      authorizationId: string,
    ): Promise<Result<AuthorizationChallenge | undefined, InvalidInput>> =>
      readOptional(
        redis,
        authorizationChallengeKey(dispatchId, authorizationId),
        decodeAuthorizationChallenge,
      ),

    target: (dispatchId: string): Promise<Result<RenderTarget | undefined, InvalidInput>> =>
      readOptional(redis, renderTargetKey(dispatchId), decodeRenderTarget),

    projection: (
      dispatchId: string,
      anchorMessageId?: string,
    ): Promise<Result<StoredRenderProjection, InvalidInput>> =>
      readProjection(redis, dispatchId, anchorMessageId),

    checkpoint: async (
      dispatchId: string,
      claimToken: string,
      projection: RenderProjection,
      appliedRevision: number,
    ): Promise<boolean> =>
      Number(
        await redis.eval(
          CHECKPOINT_SCRIPT,
          [renderClaimKey(dispatchId), renderProjectionKey(dispatchId)],
          [
            claimToken,
            z.encode(projectionCodec, storedProjection(projection, appliedRevision)),
            PROJECTION_TTL_SECONDS,
            CLAIM_TTL_MS,
          ],
        ),
      ) === 1,

    complete: (
      dispatchId: string,
      claimToken: string,
      projection: RenderProjection,
      appliedRevision: number,
      terminal: boolean,
    ): Promise<"caught-up" | "newer" | "lost"> =>
      completeRender(redis, { dispatchId, claimToken, projection, appliedRevision, terminal }),

    release: async (dispatchId: string, claimToken: string): Promise<void> => {
      await redis.eval(RELEASE_SCRIPT, [renderClaimKey(dispatchId)], [claimToken]);
    },

    outcome: async (dispatchId: string): Promise<"applied" | "discarded" | undefined> => {
      const raw: unknown = await redis.get(renderOutcomeKey(dispatchId));
      return raw === "applied" || raw === "discarded" ? raw : undefined;
    },

    ready: async (): Promise<readonly string[]> => {
      const members = await redis.smembers(AGENT_RENDER_READY_SET_KEY);
      return renderIds(members);
    },

    discard: async (dispatchId: string): Promise<void> => {
      await redis.eval(
        DISCARD_SCRIPT,
        [
          AGENT_RENDER_READY_SET_KEY,
          renderIntentKey(dispatchId),
          renderTargetKey(dispatchId),
          renderProjectionKey(dispatchId),
          renderOutcomeKey(dispatchId),
        ],
        [renderMember(dispatchId), PROJECTION_TTL_SECONDS],
      );
    },
  };
}
