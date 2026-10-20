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

export function decodeTaskProgress(value: unknown) {
  const parsed = taskEvent.safeParse(value);
  if (!parsed.success) return undefined;
  const event = parsed.data;
  if (event.type === "agent.started") {
    return {
      summary: `${event.data.name} started`,
      // Current providers are local. Never follow a remote session id at our
      // origin; its authenticated parent proxy needs the current Eve client.
      ...(event.data.remote === undefined
        ? { child: { sessionId: event.data.sessionId, name: event.data.name } }
        : {}),
    };
  }
  if (event.type === "task.started") {
    return { summary: `${event.data.name} started` };
  }
  return { summary: `${event.data.name ?? "task"} ${event.data.status}` };
}
