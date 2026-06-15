"use client";

import { useCallback, useReducer, useRef, useState } from "react";

import type { SimApproveRequest, SimChatRequest, SimEvent } from "@/lib/simulator/types";

import type { SimState } from "./types.ts";

import { initialSimState, reduceSim } from "./message-store.ts";

const CHAT_URL = "/api/simulator/chat";
const APPROVE_URL = "/api/simulator/approve";

interface DecideOptions {
  asUserId?: string;
  asRoles?: string[];
}

interface SimulatorStream {
  state: SimState;
  status: SimState["status"];
  startTurn: (req: SimChatRequest) => Promise<void>;
  decideApproval: (
    approvalId: string,
    decision: "approve" | "deny",
    opts?: DecideOptions,
  ) => Promise<void>;
  selectChannel: (channelId: string) => void;
}

/** What draining the SSE buffer needs to do per parsed event. */
interface FrameSink {
  onEvent: (event: SimEvent) => void;
}

/** Parse one SSE frame's `data:` lines into a `SimEvent`, or null if none. */
function parseFrame(frame: string): SimEvent | null {
  const dataLines = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  if (dataLines.length === 0) return null;
  try {
    return JSON.parse(dataLines.join("\n")) as SimEvent;
  } catch {
    return null;
  }
}

/** Emit every complete `\n\n`-delimited frame, returning the unconsumed tail. */
function drainFrames(buffer: string, sink: FrameSink): string {
  let rest = buffer;
  let boundary = rest.indexOf("\n\n");
  while (boundary !== -1) {
    const frame = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const event = parseFrame(frame);
    if (event) sink.onEvent(event);
    boundary = rest.indexOf("\n\n");
  }
  return rest;
}

/**
 * Drives one simulator session. `startTurn` opens a fetch-POST SSE stream
 * (browser `EventSource` is GET-only) and folds every parsed `SimEvent` into
 * the reducer as it arrives — edits are NOT throttled client-side; the backend
 * already paces them at ~1.5s so each `message.edit` is rendered verbatim,
 * letting you watch the reply grow.
 */
export function useSimulatorStream(sessionId: string): SimulatorStream {
  const [state, dispatch] = useReducer(reduceSim, undefined, initialSimState);
  const [status, setStatus] = useState<SimState["status"]>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const startTurn = useCallback(async (req: SimChatRequest) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("streaming");

    let response: Response;
    try {
      response = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
    } catch (err) {
      if (!controller.signal.aborted) setStatus("error");
      throw err;
    }

    if (!response.ok || !response.body) {
      setStatus("error");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sink: FrameSink = {
      onEvent: (event) => {
        dispatch(event);
        if (event.type === "run.finish") setStatus("done");
        else if (event.type === "run.error") setStatus("error");
      },
    };
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = drainFrames(buffer, sink);
      }
    } catch (err) {
      if (!controller.signal.aborted) setStatus("error");
      throw err;
    }
  }, []);

  const selectChannel = useCallback((channelId: string) => {
    dispatch({ type: "ui.selectChannel", channelId });
  }, []);

  const decideApproval = useCallback(
    async (approvalId: string, decision: "approve" | "deny", opts?: DecideOptions) => {
      const body: SimApproveRequest = {
        sessionId,
        approvalId,
        decision,
        ...(opts?.asUserId ? { clickerUserId: opts.asUserId } : {}),
        ...(opts?.asRoles ? { clickerRoles: opts.asRoles } : {}),
      };
      await fetch(APPROVE_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [sessionId],
  );

  return { state, status, startTurn, decideApproval, selectChannel };
}
