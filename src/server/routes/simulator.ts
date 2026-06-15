import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import type { SimApproveRequest, SimChatRequest } from "@/lib/simulator/types";

import { getOrCreateSession, getSession } from "@/lib/simulator/run-registry";

const simulator = new Hono();

/**
 * Run one turn and stream the captured Discord events (placeholder, throttled
 * edits, splits, approval cards, reactions) as Server-Sent Events. One SSE
 * connection per turn; the browser keeps conversation state across turns.
 */
simulator.post("/chat", async (c) => {
  const req = await c.req.json<SimChatRequest>();
  const session = getOrCreateSession(req.sessionId);
  return streamSSE(c, async (stream) => {
    const events = session.bus.subscribe({ signal: c.req.raw.signal, replayHistory: false });
    const pump = (async () => {
      for await (const event of events) {
        await stream.writeSSE({
          event: event.type,
          id: String(event.seq),
          data: JSON.stringify(event),
        });
        if (event.type === "run.finish" || event.type === "run.error") break;
      }
    })();
    try {
      await session.runTurn(req);
    } finally {
      await pump;
    }
  });
});

/** Drive the real approval-button handler → unblocks the waiting tool wrapper. */
simulator.post("/approve", async (c) => {
  const body = await c.req.json<SimApproveRequest>();
  const session = getSession(body.sessionId);
  if (!session) return c.json({ ok: false, reason: "no active session" }, 404);
  return c.json(await session.decide(body));
});

/** Reconnect hydration: current virtual-server snapshot + the event history. */
simulator.get("/state", (c) => {
  const session = getSession(c.req.query("sessionId") ?? "");
  if (!session) return c.json({ guild: null, history: [] });
  return c.json({ guild: session.guild.snapshot(), history: session.bus.history() });
});

export default simulator;
