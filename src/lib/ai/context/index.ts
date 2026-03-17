import type { Message, Thread } from "chat";

import type { ThreadState } from "../../bot/types";
import type { ChannelInfo, SerializedAgentContext, ThreadInfo } from "./types";
import type { DiscordRole as DiscordRoleValue } from "./types";

import { DiscordContext } from "./discord";

/**
 * Agent execution context injected into every agent's system prompt.
 * Captures user identity, channel location, role, and date.
 */
export class AgentContext {
  readonly userId: string;
  readonly username: string;
  readonly nickname: string;
  readonly channel: ChannelInfo;
  readonly thread?: ThreadInfo;
  readonly date: string;
  readonly recentMessages?: string;
  readonly role: DiscordRoleValue;

  constructor(
    thread: Thread<ThreadState>,
    discord: DiscordContext,
    opts?: { recentMessages?: string },
  ) {
    this.userId = discord.userId;
    this.username = discord.username;
    this.nickname = discord.nickname;
    this.channel = { id: thread.channelId, name: thread.channelId };
    this.date = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    this.role = discord.role;
    this.recentMessages = opts?.recentMessages;
  }

  /** Shorthand: build from a gateway message without touching DiscordContext directly. */
  static fromMessage(
    thread: Thread<ThreadState>,
    message: Message,
    opts?: { recentMessages?: string },
  ) {
    return new AgentContext(thread, DiscordContext.fromMessage(message), opts);
  }

  /** Type guard for plain objects matching the AgentContext shape. */
  static is(value: unknown): value is SerializedAgentContext {
    return (
      typeof value === "object" &&
      value !== null &&
      "userId" in value &&
      "role" in value &&
      "date" in value
    );
  }

  /** Reconstruct an AgentContext from a plain JSON object (e.g. after workflow deserialization). */
  static fromJSON(data: SerializedAgentContext) {
    return Object.assign(Object.create(AgentContext.prototype), data) as AgentContext;
  }

  /**
   * Combine a base system prompt with execution context blocks.
   * Replaces `{{DATE}}` and appends a YAML `<execution_context>` block.
   */
  buildInstructions(baseInstructions: string) {
    const resolved = baseInstructions.replace("{{DATE}}", this.date);
    const parts = [resolved, this.toPromptBlock()];
    if (this.recentMessages) parts.push(this.recentMessages);
    return parts.join("\n\n");
  }

  /** Render identity/location as a YAML block for the system prompt. */
  private toPromptBlock() {
    const threadBlock = this.thread
      ? `\nthread:\n  name: ${JSON.stringify(this.thread.name)}\n  id: "${this.thread.id}"\n  parent_channel: "#${this.thread.parentChannel.name}"`
      : "";

    return `<execution_context>
\`\`\`yaml
user:
  username: "${this.username}"
  nickname: ${JSON.stringify(this.nickname)}
  id: "${this.userId}"
channel:
  name: "#${this.channel.name}"
  id: "${this.channel.id}"${threadBlock}
date: "${this.date}"
\`\`\`
</execution_context>`;
  }
}
