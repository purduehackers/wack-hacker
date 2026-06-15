import type { SimEvent, SimMessage, SimReaction, VirtualChannel } from "@/lib/simulator/types";

import type { SimAction, SimState, SimTraceEntry } from "./types.ts";

export function initialSimState(): SimState {
  return {
    order: [],
    byId: {},
    channels: {},
    channelOrder: [],
    threadStarters: {},
    trace: [],
    status: "idle",
  };
}

/** Append a message, ignoring duplicate ids (idempotent on replay). */
function applyCreate(state: SimState, message: SimMessage): SimState {
  if (state.byId[message.id]) {
    return { ...state, byId: { ...state.byId, [message.id]: message } };
  }
  return {
    ...state,
    order: [...state.order, message.id],
    byId: { ...state.byId, [message.id]: message },
  };
}

/** Patch the parts a `message.edit` carries; absent fields are left untouched. */
function applyEdit(state: SimState, event: Extract<SimEvent, { type: "message.edit" }>): SimState {
  const existing = state.byId[event.messageId];
  if (!existing) return state;
  const next: SimMessage = {
    ...existing,
    editedAt: event.editedAt,
    ...(event.content !== undefined ? { content: event.content } : {}),
    ...(event.embeds !== undefined ? { embeds: event.embeds } : {}),
    ...(event.components !== undefined ? { components: event.components } : {}),
  };
  return { ...state, byId: { ...state.byId, [event.messageId]: next } };
}

function applyDelete(state: SimState, messageId: string): SimState {
  if (!state.byId[messageId]) return state;
  const byId = { ...state.byId };
  delete byId[messageId];
  return { ...state, order: state.order.filter((id) => id !== messageId), byId };
}

function applyReactionAdd(
  state: SimState,
  messageId: string,
  emoji: string,
  byBot: boolean,
): SimState {
  const existing = state.byId[messageId];
  if (!existing) return state;
  const found = existing.reactions.find((r) => r.emoji === emoji);
  let reactions: SimReaction[];
  if (found) {
    reactions = existing.reactions.map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + 1, me: r.me || !byBot } : r,
    );
  } else {
    reactions = [...existing.reactions, { emoji, count: 1, me: !byBot }];
  }
  return { ...state, byId: { ...state.byId, [messageId]: { ...existing, reactions } } };
}

function applyReactionRemove(
  state: SimState,
  messageId: string,
  emoji: string,
  byBot: boolean,
): SimState {
  const existing = state.byId[messageId];
  if (!existing) return state;
  const reactions = existing.reactions
    .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, me: byBot ? r.me : false } : r))
    .filter((r) => r.count > 0);
  return { ...state, byId: { ...state.byId, [messageId]: { ...existing, reactions } } };
}

/** Register a channel/thread if new, preserving sidebar order. */
function registerChannel(state: SimState, channel: VirtualChannel): SimState {
  if (state.channels[channel.id]) {
    return { ...state, channels: { ...state.channels, [channel.id]: channel } };
  }
  return {
    ...state,
    channels: { ...state.channels, [channel.id]: channel },
    channelOrder: [...state.channelOrder, channel.id],
  };
}

function applyGuildSync(
  state: SimState,
  event: Extract<SimEvent, { type: "guild.sync" }>,
): SimState {
  let next: SimState = { ...state, guild: event.guild };
  for (const channel of event.guild.channels) next = registerChannel(next, channel);
  if (!next.activeChannelId) {
    const firstChannel = next.channelOrder.find((id) => next.channels[id]?.kind === "channel");
    next = { ...next, activeChannelId: firstChannel ?? next.channelOrder[0] };
  }
  return next;
}

function applyChannelCreate(
  state: SimState,
  event: Extract<SimEvent, { type: "channel.create" }>,
): SimState {
  let next = registerChannel(state, {
    id: event.channelId,
    name: event.name,
    kind: event.kind,
    parentId: event.parentId,
  });
  if (event.kind === "thread") {
    // Auto-open the new thread, the way Discord jumps you into one, and record
    // the parent-channel message it branched from so the thread can show it.
    next = { ...next, activeChannelId: event.channelId };
    if (event.starterMessageId) {
      next = {
        ...next,
        threadStarters: { ...next.threadStarters, [event.channelId]: event.starterMessageId },
      };
    }
  }
  return next;
}

function pushTrace(state: SimState, entry: SimTraceEntry): SimState {
  return { ...state, trace: [...state.trace, entry] };
}

/** Tool start opens a timeline row; result/error closes the matching row with a duration. */
function applyTraceTool(
  state: SimState,
  event: Extract<SimEvent, { type: "trace.tool" }>,
): SimState {
  const label = event.delegateName ? `delegate › ${event.delegateName}` : event.toolName;
  if (event.phase === "start") {
    return pushTrace(state, {
      seq: event.seq,
      ts: event.ts,
      kind: "tool",
      label,
      ref: event.toolCallId,
    });
  }
  const trace = state.trace.map((entry) =>
    entry.ref === event.toolCallId && entry.kind === "tool"
      ? {
          ...entry,
          kind: event.phase === "error" ? ("tool-error" as const) : ("tool-done" as const),
          durationMs: event.ts - entry.ts,
        }
      : entry,
  );
  return { ...state, trace };
}

/**
 * Fold one event/action into the session view. Always returns a fresh
 * `SimState` (or the same reference for a no-op) so React equality checks stay
 * honest.
 */
export function reduceSim(state: SimState, action: SimAction): SimState {
  switch (action.type) {
    case "ui.selectChannel":
      return { ...state, activeChannelId: action.channelId };
    case "guild.sync":
      return applyGuildSync(state, action);
    case "channel.create":
      return applyChannelCreate(state, action);
    case "run.start":
      return {
        ...state,
        status: "streaming",
        activeChannelId: action.channelId,
        trace: [
          { seq: action.seq, ts: action.ts, kind: "turn", label: `Turn ${action.turnIndex}` },
        ],
      };
    case "run.finish":
      return pushTrace(
        { ...state, status: "done" },
        {
          seq: action.seq,
          ts: action.ts,
          kind: "finish",
          label: "Finished",
          detail: `${action.usage.totalTokens.toLocaleString("en-US")} tok · ${action.usage.toolCallCount} tool · ${action.usage.stepCount} steps`,
        },
      );
    case "run.error":
      return pushTrace(
        { ...state, status: "error" },
        {
          seq: action.seq,
          ts: action.ts,
          kind: "error",
          label: "Error",
          detail: action.message,
        },
      );
    case "message.create":
      return applyCreate(state, action.message);
    case "message.edit":
      return applyEdit(state, action);
    case "message.delete":
      return applyDelete(state, action.messageId);
    case "reaction.add":
      return applyReactionAdd(state, action.messageId, action.emoji, action.byBot);
    case "reaction.remove":
      return applyReactionRemove(state, action.messageId, action.emoji, action.byBot);
    case "context.snapshot":
      return { ...state, contextSnapshot: action.snapshot };
    case "trace.tool":
      return applyTraceTool(state, action);
    case "approval.prompt":
      return pushTrace(state, {
        seq: action.seq,
        ts: action.ts,
        kind: "approval",
        label: `Approval · ${action.toolName}`,
        detail: action.reason,
      });
    case "approval.decision":
      return pushTrace(state, {
        seq: action.seq,
        ts: action.ts,
        kind: "decision",
        label: `Approval ${action.status}`,
        detail: action.decidedByUserId ? `by ${action.decidedByUserId}` : undefined,
      });
    default:
      return state;
  }
}

/**
 * Messages belonging to one channel/thread, in arrival order. For a thread,
 * the parent-channel message it branched from is prepended as the starter
 * (mirroring how Discord shows the originating message atop a thread).
 */
export function messagesForChannel(state: SimState, channelId: string | undefined): SimMessage[] {
  if (!channelId) return [];
  const own = state.order
    .map((id) => state.byId[id])
    .filter((message) => message.channelId === channelId && !message.ephemeral);
  const starterId = state.threadStarters[channelId];
  const starter = starterId ? state.byId[starterId] : undefined;
  return starter ? [starter, ...own] : own;
}
