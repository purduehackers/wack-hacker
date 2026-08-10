/** Agent-owned desired render publication into the shared conversation aggregate. */

import type { RedisClient } from "../redis/client.ts";
import type { ParkedPayload, RenderIntent } from "../wire.ts";
import {
  activeKey,
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  parkedKey,
  queueMember,
  renderIntentKey,
  renderMember,
  renderOutcomeKey,
} from "./keys.ts";

const INTENT_TTL_SECONDS = 7 * 24 * 60 * 60;

const PUBLISH_SCRIPT = `
-- wack:publish-render
local activeRaw = redis.call("GET", KEYS[3])
if not activeRaw then return 0 end
local active = cjson.decode(activeRaw)
if active.dispatchId ~= ARGV[6] or active.messageId ~= ARGV[7] then return 0 end
if active.phase ~= "live" then return 0 end
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
redis.call("DEL", KEYS[4])
local added = redis.call("SADD", KEYS[2], ARGV[3])
if added == 1 then return 1 end
return 3
`;

const SETTLE_SCRIPT = `
-- wack:settle-render-and-park
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local active = cjson.decode(raw)
if active.dispatchId ~= ARGV[1] or active.messageId ~= ARGV[2] then return -1 end
if active.phase ~= "live" and active.phase ~= "parked" then return -1 end
if active.sessionId ~= "" and active.sessionId ~= ARGV[3] then return -1 end
if active.phase == "parked" and active.eveTurnId and active.eveTurnId ~= ARGV[5] then return -1 end

local requestedRevision = tonumber(ARGV[7])
local settledRevision = requestedRevision
local desired = redis.call("GET", KEYS[4])
if desired then
  local decoded = cjson.decode(desired)
  local currentRevision = tonumber(decoded.revision)
  if decoded.phase == "streaming" then
    -- Agent state can crash before recording a successful publish. A terminal
    -- intent must therefore fence above Redis, not only above local state.
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

active.phase = "parked"
active.sessionId = ARGV[3]
active.eveTurnId = ARGV[5]
redis.call("SET", KEYS[1], cjson.encode(active))
redis.call("SET", KEYS[2], ARGV[4])
redis.call("SADD", KEYS[3], ARGV[6])
return settledRevision
`;

interface RenderPublication {
  readonly accepted: boolean;
  readonly shouldWake: boolean;
}

export function createRenderPublicationTransitions(redis: Pick<RedisClient, "eval">) {
  return {
    publish: async (intent: RenderIntent): Promise<RenderPublication> => {
      const outcome = Number(
        await redis.eval(
          PUBLISH_SCRIPT,
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
            INTENT_TTL_SECONDS,
            intent.phase,
            intent.dispatchId,
            intent.messageId,
          ],
        ),
      );
      if (outcome === -2) throw new Error("render revision was reused with different content");
      return { accepted: outcome !== 0, shouldWake: outcome !== 0 && outcome !== 3 };
    },

    settleAndPark: async (
      intent: RenderIntent,
      parked: ParkedPayload,
    ): Promise<number | undefined> => {
      if (intent.phase === "streaming") throw new Error("cannot settle a streaming render intent");
      const outcome = Number(
        await redis.eval(
          SETTLE_SCRIPT,
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
            INTENT_TTL_SECONDS,
          ],
        ),
      );
      if (outcome === -2)
        throw new Error("terminal render revision was reused with different content");
      return outcome > 0 ? outcome : undefined;
    },
  };
}
