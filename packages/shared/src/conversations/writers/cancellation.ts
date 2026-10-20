/**
 * A durable command outbox for the existing task. This never releases a delivery,
 * declares it cancelled, or replays its external work.
 */
import { z } from "zod";

import { stored } from "../../json.ts";
import type { RedisClient } from "../../redis/client.ts";
import type { CancelRequestPayload, CancelResponse } from "../../wire.ts";
import {
  activeKey,
  AGENT_CANCEL_READY_SET_KEY,
  AGENT_RENDER_READY_SET_KEY,
  dispatchIdFromRenderMember,
  renderIntentKey,
  renderMember,
  renderProjectionKey,
  renderTargetKey,
  resetKey,
  taskControlKey,
} from "../keys.ts";
import { taskControlSchema, type TaskControl } from "../records/cancellation.ts";
import { RENDER_TTL_SECONDS } from "../records/render.ts";

const controlRecord = stored(taskControlSchema);

/**
 * RenderIntent is strict and revision occurs only at its top level. Replacing
 * that numeric token preserves empty option arrays and every other exact byte;
 * a cjson re-encode would silently turn [] into {}.
 */
const BUMP_REVISION = `
local function bumpedRevision(raw, revision)
  local updated, count = string.gsub(raw, '("revision"%s*:%s*)%d+', function(prefix)
    return prefix .. tostring(revision + 1)
  end, 1)
  if count ~= 1 then error("render intent has no revision token") end
  return updated
end
`;

const REQUEST = `
${BUMP_REVISION}
-- cancellation:request
local raw = redis.call("GET", KEYS[1])
local targetRaw = redis.call("GET", KEYS[2])
local controlRaw = redis.call("GET", KEYS[3])
local projectionRaw = redis.call("GET", KEYS[4])
if not raw or not targetRaw or not controlRaw or not projectionRaw then return "stale" end
local intent, target = cjson.decode(raw), cjson.decode(targetRaw)
local control, projection = cjson.decode(controlRaw), cjson.decode(projectionRaw)
local payload = cjson.decode(ARGV[1])
if target.dispatchId ~= payload.dispatchId or target.continuationKey ~= payload.continuationKey
  or target.channelId ~= payload.channelId or target.requesterUserId ~= payload.principal.userId
  or intent.dispatchId ~= payload.dispatchId or intent.continuationKey ~= payload.continuationKey
  or intent.messageId ~= target.messageId or intent.sessionId ~= payload.sessionId
  or intent.eveTurnId ~= payload.eveTurnId
  or control.sessionId ~= payload.sessionId or control.eveTurnId ~= payload.eveTurnId
  or control.capability ~= "exact-turn-cancel-v1"
then return "stale" end
-- Only the requester may withdraw their work. This is not tool execution
-- authority, so losing an organizer role does not trap their pending approval.
if control.request then
  local previous = cjson.decode(control.request.payload)
  if previous.anchorMessageId ~= payload.anchorMessageId
    or previous.renderRevision ~= payload.renderRevision
    or previous.principal.userId ~= payload.principal.userId
  then return "stale" end
  return control.request.status
end
if intent.phase ~= "streaming" or control.outcome then return "stale" end
if tonumber(intent.revision) ~= payload.renderRevision
  or projection.anchorMessageId ~= payload.anchorMessageId
  or tonumber(projection.appliedRevision) ~= payload.renderRevision
then return "stale" end
if redis.call("GET", KEYS[5]) then return "stale" end
local activeRaw = redis.call("GET", KEYS[6])
if not activeRaw then return "stale" end
local active = cjson.decode(activeRaw)
if active.phase ~= "live" or active.dispatchId ~= payload.dispatchId
  or active.messageId ~= target.messageId or active.sessionId ~= payload.sessionId
then return "stale" end
if active.ingress and tonumber(active.ingress.expiresAtMs) > tonumber(ARGV[4]) then
  return "busy"
end
control.request = { payload = ARGV[1], status = "pending" }
local bumped = bumpedRevision(raw, intent.revision)
redis.call("SET", KEYS[3], cjson.encode(control), "EX", tonumber(ARGV[3]))
-- Reuse render convergence and its visibility fence, including crash recovery.
redis.call("SET", KEYS[1], bumped, "KEEPTTL")
redis.call("SADD", KEYS[7], ARGV[2])
redis.call("SADD", KEYS[8], ARGV[2])
return "pending"
`;

const AUTHORIZE = `
-- cancellation:authorize
local raw = redis.call("GET", KEYS[1])
local controlRaw = redis.call("GET", KEYS[2])
local targetRaw = redis.call("GET", KEYS[3])
local activeRaw = redis.call("GET", KEYS[4])
if not raw or not controlRaw or not targetRaw then return "stale" end
local intent, control, target = cjson.decode(raw), cjson.decode(controlRaw), cjson.decode(targetRaw)
local payload = cjson.decode(ARGV[1])
local command = control.request
local submitted = command and cjson.decode(command.payload) or nil
if not submitted or submitted.interactionId ~= payload.interactionId
  or submitted.renderRevision ~= payload.renderRevision
  or submitted.anchorMessageId ~= payload.anchorMessageId
  or submitted.principal.userId ~= payload.principal.userId
  or target.requesterUserId ~= payload.principal.userId or target.channelId ~= payload.channelId
  or target.dispatchId ~= payload.dispatchId or target.continuationKey ~= payload.continuationKey
  or target.messageId ~= intent.messageId
  or intent.dispatchId ~= payload.dispatchId or intent.continuationKey ~= payload.continuationKey
  or intent.sessionId ~= payload.sessionId or intent.eveTurnId ~= payload.eveTurnId
  or control.sessionId ~= payload.sessionId or control.eveTurnId ~= payload.eveTurnId
  or control.capability ~= "exact-turn-cancel-v1"
then return "stale" end
if command.status ~= "pending" then return command.status end
if control.outcome or intent.phase ~= "streaming" then return "no-active-turn" end
if redis.call("GET", KEYS[5]) then return "stale" end
if not activeRaw then return "no-active-turn" end
local active = cjson.decode(activeRaw)
if active.phase ~= "live" or active.dispatchId ~= payload.dispatchId
  or active.sessionId ~= payload.sessionId then return "stale" end
-- A concurrent input response may have just won ingress. Try again after it
-- settles; the engine turn id still fences any later cancellation.
if active.ingress and tonumber(active.ingress.expiresAtMs) > tonumber(ARGV[2]) then return "busy" end
return "pending"
`;

const ACKNOWLEDGE = `
${BUMP_REVISION}
-- cancellation:acknowledge
local raw = redis.call("GET", KEYS[1])
if not raw then redis.call("SREM", KEYS[3], ARGV[4]) return 0 end
local control = cjson.decode(raw)
if control.sessionId ~= ARGV[1] or control.eveTurnId ~= ARGV[2]
  or not control.request or cjson.decode(control.request.payload).interactionId ~= ARGV[3]
then return 0 end
if control.request.status ~= "pending" then return 1 end
control.request.status = ARGV[5]
redis.call("SET", KEYS[1], cjson.encode(control), "KEEPTTL")
redis.call("SREM", KEYS[3], ARGV[4])
local intentRaw = redis.call("GET", KEYS[2])
if intentRaw then
  local intent = cjson.decode(intentRaw)
  if intent.phase == "streaming" and intent.sessionId == ARGV[1] and intent.eveTurnId == ARGV[2] then
    redis.call("SET", KEYS[2], bumpedRevision(intentRaw, intent.revision), "KEEPTTL")
    redis.call("SADD", KEYS[4], ARGV[4])
  end
end
return 1
`;

const statusSchema = z.enum([
  "pending",
  "accepted",
  "no-active-turn",
  "stale",
  "unsupported",
  "busy",
]);
export type CancellationStatus = z.output<typeof statusSchema>;

export class CancellationWriter {
  private readonly redis: Pick<RedisClient, "get" | "eval" | "smembers" | "srem">;

  constructor(redis: Pick<RedisClient, "get" | "eval" | "smembers" | "srem">) {
    this.redis = redis;
  }

  async read(dispatchId: string): Promise<TaskControl | undefined> {
    const raw = await this.redis.get(taskControlKey(dispatchId));
    if (raw === undefined || raw === null) return undefined;
    // Malformed control state fails closed; it must not expose a Stop button.
    return controlRecord.parse(raw);
  }

  async pending(): Promise<string[]> {
    return (await this.redis.smembers(AGENT_CANCEL_READY_SET_KEY)).flatMap((member) => {
      const dispatchId = dispatchIdFromRenderMember(member);
      return dispatchId === undefined ? [] : [dispatchId];
    });
  }

  async forgetPending(dispatchId: string): Promise<void> {
    await this.redis.srem(AGENT_CANCEL_READY_SET_KEY, renderMember(dispatchId));
  }

  async request(payload: CancelRequestPayload): Promise<CancellationStatus> {
    return statusSchema.parse(
      await this.redis.eval(
        REQUEST,
        [
          renderIntentKey(payload.dispatchId),
          renderTargetKey(payload.dispatchId),
          taskControlKey(payload.dispatchId),
          renderProjectionKey(payload.dispatchId),
          resetKey(payload.continuationKey),
          activeKey(payload.continuationKey),
          AGENT_CANCEL_READY_SET_KEY,
          AGENT_RENDER_READY_SET_KEY,
        ],
        [JSON.stringify(payload), renderMember(payload.dispatchId), RENDER_TTL_SECONDS, Date.now()],
      ),
    );
  }

  /** Recheck the durable command and execution owner immediately before Eve I/O. */
  async authorize(payload: CancelRequestPayload): Promise<CancellationStatus> {
    return statusSchema.parse(
      await this.redis.eval(
        AUTHORIZE,
        [
          renderIntentKey(payload.dispatchId),
          taskControlKey(payload.dispatchId),
          renderTargetKey(payload.dispatchId),
          activeKey(payload.continuationKey),
          resetKey(payload.continuationKey),
        ],
        [JSON.stringify(payload), Date.now()],
      ),
    );
  }

  async acknowledge(
    payload: CancelRequestPayload,
    status: Exclude<CancelResponse["status"], "busy">,
  ): Promise<void> {
    await this.redis.eval(
      ACKNOWLEDGE,
      [
        taskControlKey(payload.dispatchId),
        renderIntentKey(payload.dispatchId),
        AGENT_CANCEL_READY_SET_KEY,
        AGENT_RENDER_READY_SET_KEY,
      ],
      [
        payload.sessionId,
        payload.eveTurnId,
        payload.interactionId,
        renderMember(payload.dispatchId),
        status,
      ],
    );
  }
}
