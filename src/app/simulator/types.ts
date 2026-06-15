import type { UserRole } from "@/lib/ai/constants";
import type {
  SimContextSnapshot,
  SimEvent,
  SimMessage,
  VirtualChannel,
  VirtualEmoji,
  VirtualGuildSnapshot,
  VirtualMember,
  VirtualRole,
} from "@/lib/simulator/types";

/** One row in the inspector's "Trace" timeline, derived from the event stream. */
export interface SimTraceEntry {
  seq: number;
  ts: number;
  kind: "turn" | "tool" | "tool-done" | "tool-error" | "approval" | "decision" | "finish" | "error";
  label: string;
  detail?: string;
  durationMs?: number;
  /** toolCallId, used to match a tool's start to its result/error row. */
  ref?: string;
}

/** The reduced, render-ready view of one simulator session. */
export interface SimState {
  /** Message ids in arrival order — the source of truth for rendering order. */
  order: string[];
  byId: Record<string, SimMessage>;
  /** Channels + threads, by id (seeded from guild.sync, grown by channel.create). */
  channels: Record<string, VirtualChannel>;
  channelOrder: string[];
  /** Thread id → the parent message that started it (for the thread's header). */
  threadStarters: Record<string, string>;
  /** The channel/thread currently shown in the main view. */
  activeChannelId?: string;
  guild?: VirtualGuildSnapshot;
  /** Latest context snapshot (inspector "Context" tab). */
  contextSnapshot?: SimContextSnapshot;
  /** Current turn's event timeline (inspector "Trace" tab), reset each turn. */
  trace: SimTraceEntry[];
  status: "idle" | "streaming" | "done" | "error";
}

/** Reducer input: wire events plus client-only UI actions (channel switching). */
export type SimAction = SimEvent | { type: "ui.selectChannel"; channelId: string };

/**
 * Flat lookup tables the markdown renderer uses to turn `<@id>` / `<#id>` /
 * `<@&id>` / `<a:name:id>` tokens into rich pills. Built once per guild
 * snapshot (see {@link buildMentionResolver}) and threaded through the message
 * tree so every `renderMarkdown` call shares the same maps.
 */
export interface MentionResolver {
  members: Record<string, VirtualMember>;
  channels: Record<string, VirtualChannel>;
  roles: Record<string, VirtualRole>;
  emojis: Record<string, VirtualEmoji>;
}

/** The simulator's editable session config, owned by the page. */
export interface SimConfig {
  role: UserRole;
  username: string;
  nickname: string;
  channelName: string;
  /** Open a thread for the bot's reply to a channel message (the real bot's default). */
  openThread: boolean;
  /** When set, approval clicks come from a second organizer (not the requester). */
  approveAsSecond: boolean;
}
