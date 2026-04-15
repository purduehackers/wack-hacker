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
