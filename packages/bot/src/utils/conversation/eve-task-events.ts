import { z } from "zod";

/**
 * The bot retains Eve 0.31's transport while old deployments drain. Its NDJSON
 * reader forwards unknown events; validate 0.81's additive task frames here
 * before the legacy event union is inspected.
 */
const taskEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("agent.started"),
    data: z.object({
      name: z.string(),
      sessionId: z.string(),
      streamPath: z.string(),
      remote: z.unknown().optional(),
    }),
  }),
  z.object({
    type: z.literal("task.started"),
    data: z.object({ name: z.string(), kind: z.enum(["agent", "tool"]) }),
  }),
  z.object({
    type: z.literal("task.settled"),
    data: z.object({
      name: z.string().optional(),
      kind: z.enum(["agent", "tool"]).optional(),
      status: z.enum(["completed", "failed", "cancelled"]),
    }),
  }),
]);

const actionEvent = z.object({
  type: z.literal("actions.requested"),
  data: z.object({
    actions: z.array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("tool-call"), toolName: z.string() }),
        z.object({ kind: z.literal("workflow-tool-call"), toolName: z.string() }),
        z.object({ kind: z.literal("subagent-call"), subagentName: z.string() }),
        z.object({ kind: z.literal("remote-agent-call"), remoteAgentName: z.string() }),
        z.object({ kind: z.literal("load-skill") }),
      ]),
    ),
  }),
});

export function decodeActionProgress(value: unknown): string | undefined {
  const parsed = actionEvent.safeParse(value);
  if (!parsed.success || parsed.data.data.actions.length === 0) return undefined;
  const names = parsed.data.data.actions.map((action) => {
    switch (action.kind) {
      case "tool-call":
      case "workflow-tool-call":
        return "Working on your request";
      case "subagent-call":
      case "remote-agent-call":
        return "Working on a delegated task";
      case "load-skill":
        return "Checking guidance";
    }
  });
  return [...new Set(names)].join(", ");
}

export function decodeTaskProgress(value: unknown) {
  const parsed = taskEvent.safeParse(value);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  if (event.type === "agent.started") {
    return {
      summary: "Working on a delegated task",
      // Current providers are local. Never follow a remote session id at our
      // origin; its authenticated parent proxy needs the current Eve client.
      ...(event.data.remote === undefined
        ? { child: { sessionId: event.data.sessionId, name: event.data.name } }
        : {}),
    };
  }
  if (event.type === "task.started") {
    return {
      summary:
        event.data.kind === "agent" ? "Working on a delegated task" : "Working on your request",
    };
  }
  return {
    summary:
      event.data.status === "completed"
        ? "Task finished"
        : event.data.status === "failed"
          ? "A task needs attention"
          : "Task stopped",
  };
}
