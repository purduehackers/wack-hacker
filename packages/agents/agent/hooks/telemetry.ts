/** Delegation and turn lifecycle metrics; each agent accounts for its own model usage. */
import { defineHook } from "eve/hooks";

import { countAgentEvent, logAgentEvent } from "../lib/telemetry.ts";

export default defineHook({
  events: {
    "task.started"(event) {
      if (event.data.kind !== "agent") return;
      const attributes = { delegate: event.data.name, status: "called" };
      countAgentEvent("agent.delegation", attributes);
      logAgentEvent("agent.delegation", attributes);
    },
    "task.settled"(event) {
      if (event.data.kind !== "agent") return;
      const attributes = { delegate: event.data.name ?? "agent", status: event.data.status };
      countAgentEvent("agent.delegation", attributes);
      logAgentEvent("agent.delegation", attributes);
    },
    "turn.completed"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "completed", agent: ctx.agent.name });
    },
    "turn.failed"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "failed", agent: ctx.agent.name });
    },
    "turn.cancelled"(_event, ctx) {
      countAgentEvent("agent.turn", { status: "cancelled", agent: ctx.agent.name });
    },
  },
});
