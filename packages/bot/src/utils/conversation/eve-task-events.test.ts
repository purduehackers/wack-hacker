import { expect, test } from "bun:test";

import { Client } from "eve/client";

import { decodeActionProgress, decodeTaskProgress } from "./eve-task-events.ts";

const currentFrames = [
  {
    type: "task.started",
    data: { taskId: "task-1", callId: "call-1", turnId: "turn-1", name: "discord", kind: "agent" },
  },
  {
    type: "agent.started",
    data: {
      taskId: "task-1",
      callId: "call-1",
      turnId: "turn-1",
      name: "discord",
      sessionId: "child",
      streamPath: "/eve/v1/sessions/child/stream",
    },
  },
  {
    type: "actions.requested",
    data: {
      actions: [
        { kind: "workflow-tool-call", toolName: "ask_question", callId: "call-2", input: {} },
      ],
      turnId: "turn-1",
      sequence: 1,
      stepIndex: 1,
    },
  },
  {
    type: "message.completed",
    data: {
      message: "I’m checking that.",
      turnId: "turn-1",
      sequence: 1,
      stepIndex: 1,
      finishReason: "stop",
    },
  },
  { type: "turn.waiting", data: { turnId: "turn-1", sequence: 1 } },
  {
    type: "task.settled",
    data: {
      taskId: "task-1",
      callId: "call-1",
      turnId: "turn-1",
      name: "discord",
      kind: "agent",
      status: "completed",
      output: "Done",
    },
  },
  { type: "turn.completed", data: { turnId: "turn-1", sequence: 1 } },
  { type: "session.waiting", data: { continuationToken: "session", wait: "next-user-message" } },
];
const legacyFrames = [
  {
    type: "subagent.called",
    data: {
      callId: "call-1",
      childSessionId: "child",
      sessionId: "session",
      name: "discord",
      toolName: "discord",
      sequence: 1,
      turnId: "turn-1",
      workflowId: "workflow",
    },
  },
  {
    type: "actions.requested",
    data: {
      actions: [{ kind: "tool-call", toolName: "get_server_info", callId: "call-2", input: {} }],
      turnId: "turn-1",
      sequence: 1,
      stepIndex: 1,
    },
  },
  {
    type: "subagent.completed",
    data: { subagentName: "discord", output: "Done", turnId: "turn-1", sequence: 1 },
  },
  { type: "session.waiting", data: { continuationToken: "session", wait: "next-user-message" } },
];

test("retained Eve 0.31 transport reads actual NDJSON versions 21 and 26 through waiting turns", async () => {
  for (const [version, frames] of [
    ["21", legacyFrames],
    ["26", currentFrames],
  ] as const) {
    const events = frames.map((frame, index) => ({
      ...frame,
      meta: { id: `event-${index}`, at: "2026-10-19T12:00:00.000Z" },
    }));
    const body = events.map((frame) => JSON.stringify(frame)).join("\n") + "\n";
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(body, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "x-eve-stream-version": version,
            "x-eve-stream-format": "ndjson",
            "x-eve-stream-tail-index": String(events.length - 1),
          },
        }),
    });
    try {
      const client = new Client({ host: server.url.href });
      const received: unknown[] = [];
      for await (const frame of client.sessions
        .attach("session", { streamIndex: 0 })
        .stream({ follow: false, streamReconnectPolicy: { reconnect: false } }))
        received.push(frame);
      expect(received).toEqual(events);
      if (version === "26") {
        expect(
          received.map(decodeTaskProgress).filter((entry) => entry?.child !== undefined),
        ).toEqual([
          {
            summary: "Working on a delegated task",
            child: { name: "discord", sessionId: "child" },
          },
        ]);
      }
    } finally {
      await server.stop(true);
    }
  }
});

test("new and legacy actions have readable status without exposing implementation names", () => {
  for (const kind of ["tool-call", "workflow-tool-call"]) {
    expect(
      decodeActionProgress({
        type: "actions.requested",
        data: { actions: [{ kind, toolName: "discord__delete_message" }] },
      }),
    ).toBe("Working on your request");
  }
  expect(
    decodeActionProgress({
      type: "actions.requested",
      data: { actions: [{ kind: "load-skill" }] },
    }),
  ).toBe("Checking guidance");
  expect(
    decodeActionProgress({
      type: "actions.requested",
      data: { actions: [{ kind: "workflow-tool-call" }] },
    }),
  ).toBeUndefined();
  expect(
    decodeActionProgress({
      type: "actions.requested",
      data: { actions: [{ kind: "future-kind" }] },
    }),
  ).toBeUndefined();
});

test("remote child sessions never attach at the local origin", () => {
  expect(
    decodeTaskProgress({
      type: "agent.started",
      data: {
        name: "remote",
        sessionId: "child",
        streamPath: "/proxy",
        remote: { url: "https://example.com" },
      },
    }),
  ).toEqual({ summary: "Working on a delegated task" });
  expect(decodeTaskProgress({ type: "agent.started", data: { name: "broken" } })).toBeUndefined();
  expect(
    decodeTaskProgress({
      type: "task.settled",
      data: { name: "discord__delete_message", status: "failed" },
    }),
  ).toEqual({ summary: "A task needs attention" });
});
