import type { MessageCreatePacketType } from "../protocol/types.ts";
import type {
  ChannelInfo,
  ThreadInfo,
  Attachment,
  RecentMessage,
  SerializedAgentContext,
} from "./types.ts";

import { UserRole } from "./constants.ts";

export type {
  ChannelInfo,
  ThreadInfo,
  Attachment,
  RecentMessage,
  SerializedAgentContext,
} from "./types.ts";

/** Discord role IDs for Purdue Hackers server. */
const ROLE_IDS = {
  ORGANIZER: "1012751663322382438",
  ADMIN: "1344066433172373656",
} as const;

export class AgentContext {
  readonly userId: string;
  readonly username: string;
  readonly nickname: string;
  readonly channel: ChannelInfo;
  readonly thread?: ThreadInfo;
  readonly date: string;
  readonly attachments?: Attachment[];
  readonly memberRoles?: string[];
  readonly recentMessages?: RecentMessage[];

  private constructor(data: SerializedAgentContext) {
    this.userId = data.userId;
    this.username = data.username;
    this.nickname = data.nickname;
    this.channel = data.channel;
    this.thread = data.thread;
    this.date = data.date;
    this.attachments = data.attachments;
    this.memberRoles = data.memberRoles;
    this.recentMessages = data.recentMessages;
  }

  /** Resolve Discord role IDs to an application-level access tier. */
  get role(): UserRole {
    if (!this.memberRoles) return UserRole.Public;
    if (this.memberRoles.includes(ROLE_IDS.ADMIN)) return UserRole.Admin;
    if (this.memberRoles.includes(ROLE_IDS.ORGANIZER)) return UserRole.Organizer;
    return UserRole.Public;
  }

  static fromPacket(packet: MessageCreatePacketType): AgentContext {
    const { data } = packet;
    return new AgentContext({
      userId: data.author.id,
      username: data.author.username,
      nickname: data.author.nickname ?? data.author.username,
      channel: data.channel,
      thread: data.thread
        ? {
            id: data.channel.id,
            name: data.channel.name,
            parentChannel: { id: data.thread.parentId, name: data.thread.parentName },
          }
        : undefined,
      date: new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      attachments:
        data.attachments.length > 0
          ? data.attachments.map((a) => ({
              url: a.url,
              filename: a.filename,
              contentType: a.contentType,
            }))
          : undefined,
      memberRoles: data.memberRoles ?? undefined,
    });
  }

  static fromJSON(data: SerializedAgentContext): AgentContext {
    return new AgentContext(data);
  }

  toJSON(): SerializedAgentContext {
    return {
      userId: this.userId,
      username: this.username,
      nickname: this.nickname,
      channel: this.channel,
      thread: this.thread,
      date: this.date,
      attachments: this.attachments,
      memberRoles: this.memberRoles,
      recentMessages: this.recentMessages,
    };
  }

  buildInstructions(baseInstructions: string): string {
    return `${baseInstructions.replace("{{DATE}}", this.date)}\n\n${this.contextBlock()}`;
  }

  private contextBlock(): string {
    const thread = this.thread
      ? `\nthread:\n  name: ${JSON.stringify(this.thread.name)}\n  id: "${this.thread.id}"\n  parent_channel: "#${this.thread.parentChannel.name}"`
      : "";

    const recentMsgs = this.recentMessages?.length
      ? `\n\n<recent_channel_messages>\n${this.recentMessages
          .map((m) => `[${m.timestamp}] ${m.author}: ${m.content}`)
          .join("\n")}\n</recent_channel_messages>`
      : "";

    return `<execution_context>
\`\`\`yaml
user:
  username: "${this.username}"
  nickname: ${JSON.stringify(this.nickname)}
  id: "${this.userId}"
channel:
  name: "#${this.channel.name}"
  id: "${this.channel.id}"${thread}
date: "${this.date}"
\`\`\`
</execution_context>${recentMsgs}`;
  }
}
