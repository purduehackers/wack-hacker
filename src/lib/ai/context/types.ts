import type { DiscordRole } from "./enums";

export interface ChannelInfo {
  id: string;
  name: string;
}

export interface ThreadInfo {
  id: string;
  name: string;
  parentChannel: ChannelInfo;
}

/** Parsed SKILL.md frontmatter + body. */
export interface Skill {
  name: string;
  description: string;
  criteria: string;
  instructions: string;
  toolNames: string[];
}

/** Agent context shape for serialization across workflow boundaries. */
export interface SerializedAgentContext {
  userId: string;
  username: string;
  nickname: string;
  channel: ChannelInfo;
  thread?: ThreadInfo;
  date: string;
  recentMessages?: string;
  role: DiscordRole;
}
