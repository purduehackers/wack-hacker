/** Durable, coalesced desired-state publication for bot-owned Discord paint. */

import type { RedisClient } from "@repo/shared/redis";
import {
  AGENT_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  agentActiveKey,
  agentQueueMember,
  agentRenderMember,
  BOT_ROUTES,
  parkedMarkerKey,
  renderIntentKey,
  renderOutcomeKey,
} from "@repo/shared/wire";
import type { ParkedPayload, RenderIntent } from "@repo/shared/wire";

import { traceHeaders } from "../telemetry.ts";

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

export interface FooterInput {
  readonly referenceId?: string;
  readonly durationMs?: number;
  readonly tokens?: number;
  readonly toolCalls?: number;
}

export function renderFooter(input: FooterInput): string {
  const parts: string[] = [];
  if (input.referenceId !== undefined) parts.push(`\`${input.referenceId}\``);
  if (input.durationMs !== undefined) parts.push(`${(input.durationMs / 1_000).toFixed(1)}s`);
  if (input.tokens !== undefined) parts.push(`${input.tokens.toLocaleString("en-US")} tokens`);
  if (input.toolCalls !== undefined && input.toolCalls > 0) {
    parts.push(`${input.toolCalls} tool call${input.toolCalls === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export interface RenderPublisherDeps {
  readonly redis: RedisClient;
  readonly botUrl: string | (() => Promise<string>);
  readonly botSecret: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createRenderPublisher(deps: RenderPublisherDeps) {
  const doFetch = deps.fetch ?? fetch;

  return {
    publish: async (intent: RenderIntent): Promise<boolean> => {
      const outcome = Number(
        await deps.redis.eval(
          PUBLISH_SCRIPT,
          [
            renderIntentKey(intent.dispatchId),
            AGENT_RENDER_READY_SET_KEY,
            agentActiveKey(intent.continuationKey),
            renderOutcomeKey(intent.dispatchId),
          ],
          [
            intent.revision,
            JSON.stringify(intent),
            agentRenderMember(intent.dispatchId),
            INTENT_TTL_SECONDS,
            intent.phase,
            intent.dispatchId,
            intent.messageId,
          ],
        ),
      );
      if (outcome === -2) throw new Error("render revision was reused with different content");
      if (outcome === 0) return false;
      if (outcome === 3) return true;

      // Redis is the durable path. This small callback only avoids waiting for a
      // replacement bot's startup/periodic recovery sweep.
      try {
        const botUrl = typeof deps.botUrl === "string" ? deps.botUrl : await deps.botUrl();
        const response = await doFetch(new URL(BOT_ROUTES.render, botUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.botSecret}`,
            ...traceHeaders(),
          },
          body: JSON.stringify({ dispatchId: intent.dispatchId }),
          signal: AbortSignal.timeout(3_000),
        });
        if (!response.ok) throw new Error(`bot render callback returned ${response.status}`);
      } catch (cause) {
        console.warn("bot render callback failed; Redis recovery remains pending", cause);
      }
      return true;
    },

    /** Persists the terminal desired view and queue parked marker in one CAS. */
    settleAndPark: async (
      intent: RenderIntent,
      parked: ParkedPayload,
    ): Promise<number | undefined> => {
      if (intent.phase === "streaming") throw new Error("cannot settle a streaming render intent");
      const outcome = Number(
        await deps.redis.eval(
          SETTLE_SCRIPT,
          [
            agentActiveKey(parked.continuationKey),
            parkedMarkerKey(parked.continuationKey),
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
            agentQueueMember(parked.continuationKey),
            intent.revision,
            JSON.stringify(intent),
            agentRenderMember(intent.dispatchId),
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

export type RenderPublisher = ReturnType<typeof createRenderPublisher>;
