import type { MessageCreatePacketType } from "../protocol/types.ts";
import type {
  ChannelInfo,
  ThreadInfo,
  Attachment,
  RecentMessage,
  SerializedAgentContext,
} from "./types.ts";

import { DISCORD_IDS } from "../protocol/constants.ts";
import { UserRole } from "./constants.ts";

export type {
  ChannelInfo,
  ThreadInfo,
  Attachment,
  RecentMessage,
  SerializedAgentContext,
} from "./types.ts";

import { DEFAULT_TIMEZONE } from "../tasks/constants.ts";

/**
 * Minute-precision UTC instant. `nowISO` is interpolated into the system
 * prompt; sub-minute precision would make every rendered prompt unique and
 * defeat Anthropic prompt caching.
 */
function toMinuteISO(date: Date): string {
  return `${date.toISOString().slice(0, 16)}:00Z`;
}

/**
 * Cap on each rendered lead-in block (`<recent_*_messages>` /
 * `<referenced_message_context>`). The lead-in is pinned into the system
 * prompt for the conversation's lifetime, so an unbounded block from a busy
 * channel would be re-billed on every step of every turn.
 */
const MAX_LEADIN_BLOCK_CHARS = 4000;

/**
 * Drop lines from the front until the block fits the budget. The most
 * relevant lines live at the end of both lead-in blocks: newest messages for
 * the recent tail, the reply anchor for referenced context.
 */
function capBlockLines(lines: string[], maxChars: number): string[] {
  let total = lines.reduce((sum, entry) => sum + entry.length + 1, 0);
  let start = 0;
  while (start < lines.length - 1 && total > maxChars) {
    total -= lines[start].length + 1;
    start += 1;
  }
  return start === 0 ? lines : lines.slice(start);
}

export class AgentContext {
  readonly userId: string;
  readonly username: string;
  readonly nickname: string;
  readonly channel: ChannelInfo;
  readonly thread?: ThreadInfo;
  readonly date: string;
  readonly nowISO: string;
  readonly timezone: string;
  readonly attachments?: Attachment[];
  readonly memberRoles?: string[];
  readonly recentMessages?: RecentMessage[];
  readonly recentMessagesFromThread?: boolean;
  readonly referencedContext?: RecentMessage[];

  private constructor(data: SerializedAgentContext) {
    this.userId = data.userId;
    this.username = data.username;
    this.nickname = data.nickname;
    this.channel = data.channel;
    this.thread = data.thread;
    this.date = data.date;
    // Default nowISO/timezone on deserialize so legacy serialized contexts
    // (written before these fields existed) still round-trip cleanly.
    this.nowISO = data.nowISO ?? toMinuteISO(new Date());
    this.timezone = data.timezone ?? DEFAULT_TIMEZONE;
    this.attachments = data.attachments;
    this.memberRoles = data.memberRoles;
    this.recentMessages = data.recentMessages;
    this.recentMessagesFromThread = data.recentMessagesFromThread;
    this.referencedContext = data.referencedContext;
  }

  /** Resolve Discord role IDs to an application-level access tier. */
  get role(): UserRole {
    if (!this.memberRoles) return UserRole.Public;
    if (this.memberRoles.includes(DISCORD_IDS.roles.ADMIN)) return UserRole.Admin;
    if (this.memberRoles.includes(DISCORD_IDS.roles.ORGANIZER)) return UserRole.Organizer;
    return UserRole.Public;
  }

  /**
   * Build context from a Discord message packet.
   *
   * - `threadOverride`: supply when a thread was just created for this mention.
   *   The packet still describes the parent channel; pass the new thread and
   *   the context's `channel`/`thread` fields will reflect the thread instead.
   * - `recentMessages`: attach the recent-messages block fetched separately.
   * - `referencedContext`: attach a second lead-in block built from the
   *   referenced message (when the mention was a reply) plus messages
   *   preceding it.
   */
  static fromPacket(
    packet: MessageCreatePacketType,
    options?: {
      threadOverride?: { id: string; name: string };
      recentMessages?: RecentMessage[];
      referencedContext?: RecentMessage[];
    },
  ): AgentContext {
    const { data } = packet;
    const { threadOverride, recentMessages, referencedContext } = options ?? {};

    let channel: ChannelInfo;
    let thread: ThreadInfo | undefined;

    if (threadOverride) {
      channel = { id: threadOverride.id, name: threadOverride.name };
      thread = {
        id: threadOverride.id,
        name: threadOverride.name,
        parentChannel: data.channel,
      };
    } else if (data.thread) {
      channel = data.channel;
      thread = {
        id: data.channel.id,
        name: data.channel.name,
        parentChannel: { id: data.thread.parentId, name: data.thread.parentName },
      };
    } else {
      channel = data.channel;
      thread = undefined;
    }

    // recentMessages came from the thread iff the triggering packet was
    // already in a thread AND we aren't synthesizing a newly-created one.
    // When threadOverride is set, the thread was JUST created so any messages
    // we fetched were pulled from the parent channel.
    const recentMessagesFromThread =
      recentMessages !== undefined && Boolean(data.thread) && !threadOverride;

    const now = new Date();
    return new AgentContext({
      userId: data.author.id,
      username: data.author.username,
      nickname: data.author.nickname ?? data.author.username,
      channel,
      thread,
      date: now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      nowISO: toMinuteISO(now),
      timezone: DEFAULT_TIMEZONE,
      attachments:
        data.attachments.length > 0
          ? data.attachments.map((a) => ({
              url: a.url,
              filename: a.filename,
              contentType: a.contentType,
            }))
          : undefined,
      memberRoles: data.memberRoles ?? undefined,
      recentMessages,
      recentMessagesFromThread,
      referencedContext,
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
      nowISO: this.nowISO,
      timezone: this.timezone,
      attachments: this.attachments,
      memberRoles: this.memberRoles,
      recentMessages: this.recentMessages,
      recentMessagesFromThread: this.recentMessagesFromThread,
      referencedContext: this.referencedContext,
    };
  }

  buildInstructions(baseInstructions: string): string {
    const replaced = baseInstructions
      .replace("{{DATE}}", this.date)
      .replace("{{NOW_ISO}}", this.nowISO)
      .replace("{{USER_TZ}}", this.timezone);
    return `${replaced}\n\n${this.contextBlock()}`;
  }

  /**
   * Render the YAML execution-context block appended to the system prompt.
   * Public so the context inspector can snapshot the exact block the orchestrator
   * saw without duplicating the YAML layout.
   */
  contextBlock(): string {
    const thread = this.thread
      ? `\nthread:\n  name: ${JSON.stringify(this.thread.name)}\n  id: "${this.thread.id}"\n  parent_channel: ${JSON.stringify(`#${this.thread.parentChannel.name}`)}`
      : "";

    // Tag the lead-in block based on where its messages actually came from,
    // not on whether the conversation is happening in a thread. A fresh
    // mention creates a thread but the lead-in is from the parent channel.
    // Legacy serialized contexts without the flag fall back to `thread`.
    const fromThread = this.recentMessagesFromThread ?? Boolean(this.thread);
    const msgTag = fromThread ? "recent_thread_messages" : "recent_channel_messages";
    const recentMsgs = this.recentMessages?.length
      ? `\n\n<${msgTag}>\n${capBlockLines(
          this.recentMessages.map((m) => `[${m.timestamp}] ${m.author}: ${m.content}`),
          MAX_LEADIN_BLOCK_CHARS,
        ).join("\n")}\n</${msgTag}>`
      : "";

    const refMsgs = this.referencedContext?.length
      ? `\n\n<referenced_message_context>\nThe user's mention was a reply to a message in this channel. Below is that message (last) plus the messages that immediately preceded it, in chronological order.\n${capBlockLines(
          this.referencedContext.map((m) => `[${m.timestamp}] ${m.author}: ${m.content}`),
          MAX_LEADIN_BLOCK_CHARS,
        ).join("\n")}\n</referenced_message_context>`
      : "";

    return `<execution_context>
\`\`\`yaml
user:
  username: ${JSON.stringify(this.username)}
  nickname: ${JSON.stringify(this.nickname)}
  id: "${this.userId}"
channel:
  name: ${JSON.stringify(`#${this.channel.name}`)}
  id: "${this.channel.id}"${thread}
date: "${this.date}"
\`\`\`
</execution_context>${recentMsgs}${refMsgs}`;
  }

  /**
   * Compact execution-context block (~60 tokens) appended to every delegation
   * subagent's instructions. The orchestrator forwards task wording verbatim,
   * so phrases like "assign to me" or "due Friday" reach the subagent
   * unresolved — this block carries the identity/time facts needed to resolve
   * them without extra discovery calls.
   */
  subagentContextBlock(): string {
    return `<execution_context>
requesting_user: ${JSON.stringify(this.nickname)} (discord id ${this.userId})
channel: ${JSON.stringify(`#${this.channel.name}`)}   date: ${this.date}   now: ${this.nowISO}   tz: ${this.timezone}
</execution_context>`;
  }
}
