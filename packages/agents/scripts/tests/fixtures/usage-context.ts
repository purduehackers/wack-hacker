import type { HookContext, HookEventMap } from "eve/hooks";

import { toolContext } from "./catalog-context.ts";

export function usageEvent(id = "usage-event"): HookEventMap["step.completed"] {
  return {
    type: "step.completed",
    meta: { id, at: "2026-10-19T12:00:00.000Z" },
    data: {
      sequence: 1,
      stepIndex: 0,
      turnId: "child-turn",
      finishReason: "stop",
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        costUsd: 0.02,
      },
    },
  };
}

export function usageContext(prefix = "usage"): HookContext {
  const context = toolContext();
  return {
    ...context,
    agent: { name: "discord" },
    channel: { kind: "discord" },
    cancel: () => {
      throw new Error("Usage hooks must not cancel a turn");
    },
    session: {
      ...context.session,
      id: `${prefix}-child`,
      parent: {
        callId: "parent-call",
        rootSessionId: `${prefix}-parent`,
        sessionId: `${prefix}-parent`,
        turn: { id: "parent-turn", sequence: 1 },
      },
    },
  };
}
