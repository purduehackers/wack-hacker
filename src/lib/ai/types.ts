import type { ToolSet } from "ai";

import type { SkillBundle } from "./skills/types.ts";

export interface ChannelInfo {
  id: string;
  name: string;
}

export interface ThreadInfo {
  id: string;
  name: string;
  parentChannel: ChannelInfo;
}

export interface Attachment {
  url: string;
  filename: string;
  contentType?: string;
}

export interface RecentMessage {
  author: string;
  content: string;
  timestamp: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SerializedAgentContext {
  userId: string;
  username: string;
  nickname: string;
  channel: ChannelInfo;
  thread?: ThreadInfo;
  date: string;
  attachments?: Attachment[];
  memberRoles?: string[];
  recentMessages?: RecentMessage[];
  /**
   * True when `recentMessages` were fetched from the thread itself (i.e. the
   * mention that started this workflow was already in a thread). False when
   * they came from a parent channel (a fresh mention that created a new
   * thread). Controls the `<recent_thread_messages>` vs `<recent_channel_messages>`
   * tag in the system prompt so the model isn't told thread context when the
   * lead-in is actually channel chatter.
   */
  recentMessagesFromThread?: boolean;
}

export interface FooterMeta {
  elapsedMs: number;
  totalTokens: number | undefined;
  toolCallCount: number;
  stepCount: number;
}

/** Mutable accumulator for subagent token/tool-call metrics. */
export interface SubagentMetrics {
  totalTokens: number;
  toolCallCount: number;
}

export interface SubagentSpec {
  /** Stable identifier used for telemetry/tracing. */
  name: string;
  /** Short description shown to the orchestrator as the delegation tool's description. */
  description: string;
  /** Full subagent system prompt. `{{SKILL_MENU}}` placeholder is replaced at runtime. */
  systemPrompt: string;
  /** All tools available to the subagent (includes base + skill-gated). */
  tools: ToolSet;
  /** Sub-skill manifest for progressive disclosure within the subagent. */
  subSkills: Record<string, SkillBundle>;
  /** Tool names always visible to the subagent (base tools). */
  baseToolNames: readonly string[];
}
