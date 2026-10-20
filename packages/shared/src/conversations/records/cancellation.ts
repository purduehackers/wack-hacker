/** Optional task controls and command receipts, outside the strict legacy render wire. */
import { z } from "zod";

import { stored } from "../../json.ts";
import { cancelRequestPayloadSchema } from "../../wire.ts";

export const taskControlSchema = z.strictObject({
  capability: z.literal("exact-turn-cancel-v1"),
  sessionId: z.string().min(1).max(128),
  eveTurnId: z.string().min(1).max(128),
  /** Only an authoritative turn.cancelled event may write this. */
  outcome: z.literal("cancelled").optional(),
  request: z
    .strictObject({
      // Lua must preserve [] (especially an unprivileged requester's roles);
      // its ordinary cjson encoding otherwise changes empty arrays into {}.
      payload: stored(cancelRequestPayloadSchema),
      status: z.enum(["pending", "accepted", "no-active-turn", "stale", "unsupported"]),
    })
    .optional(),
});

export type TaskControl = z.output<typeof taskControlSchema>;
export interface RenderControls {
  readonly outcome?: "cancelled";
}

/** Runs inside the same fence and Redis transaction as the authored render. */
export const OFFER_CONTROLS_LUA = `
local function offerControls(key, sessionId, turnId, outcome, ttl)
  local raw = redis.call("GET", key)
  local control = nil
  if raw then
    local ok, decoded = pcall(cjson.decode, raw)
    -- Optional corrupt controls must not interrupt the authoritative render.
    -- Preserve the record so the reader reports its defect and hides controls.
    if not ok or type(decoded) ~= "table"
      or decoded.capability ~= "exact-turn-cancel-v1"
      or type(decoded.sessionId) ~= "string" or type(decoded.eveTurnId) ~= "string"
    then return end
    control = decoded
  end
  if not control or control.sessionId ~= sessionId or control.eveTurnId ~= turnId then
    control = { capability = "exact-turn-cancel-v1", sessionId = sessionId, eveTurnId = turnId }
  end
  if outcome == "cancelled" then control.outcome = "cancelled" end
  redis.call("SET", key, cjson.encode(control), "EX", ttl)
end
`;
