import type {
  SimActionRow,
  SimEmbed,
  SimMessage,
  VirtualChannel,
  VirtualEmoji,
  VirtualGuildSnapshot,
  VirtualMember,
  VirtualRole,
} from "./types.ts";

interface CreateMessageInit {
  authorId: string;
  authorKind: "bot" | "user";
  content?: string;
  embeds?: SimEmbed[];
  components?: SimActionRow[];
  ephemeral?: boolean;
  approvalId?: string;
}

interface MessagePatch {
  content?: string;
  embeds?: SimEmbed[];
  components?: SimActionRow[];
}

interface VirtualGuildOptions {
  guildId: string;
  botUserId: string;
  channels?: { id?: string; name: string }[];
  members?: VirtualMember[];
  roles?: VirtualRole[];
  emojis?: VirtualEmoji[];
}

/**
 * In-memory model of one Discord server: channels/threads, messages,
 * reactions, members, roles, emoji. Pure state + id minting — it never emits
 * events (the transport adapters do), so the bus stays the single funnel.
 */
export class VirtualGuild {
  readonly guildId: string;
  readonly botUserId: string;

  private channels = new Map<string, VirtualChannel>();
  private channelIdByName = new Map<string, string>();
  private messages = new Map<string, SimMessage>();
  private members = new Map<string, VirtualMember>();
  private roles = new Map<string, VirtualRole>();
  private emojis = new Map<string, VirtualEmoji>();

  private idSeq = 1;
  private readonly idBase = 930_000_000_000_000;

  constructor(options: VirtualGuildOptions) {
    this.guildId = options.guildId;
    this.botUserId = options.botUserId;
    for (const channel of options.channels ?? []) {
      this.registerChannel(channel.id ?? this.nextId(), channel.name, "channel");
    }
    for (const member of options.members ?? []) this.members.set(member.id, member);
    for (const role of options.roles ?? []) this.roles.set(role.id, role);
    for (const emoji of options.emojis ?? []) this.emojis.set(emoji.id, emoji);
  }

  /** Mint a fresh digit-only snowflake-shaped id. */
  nextId(): string {
    return String(this.idBase + this.idSeq++);
  }

  private registerChannel(
    id: string,
    name: string,
    kind: "channel" | "thread",
    parentId?: string,
  ): VirtualChannel {
    const channel: VirtualChannel = { id, name, kind, parentId };
    this.channels.set(id, channel);
    if (!this.channelIdByName.has(name)) this.channelIdByName.set(name, id);
    return channel;
  }

  getChannel(id: string): VirtualChannel | undefined {
    return this.channels.get(id);
  }

  /** Find a channel by name, creating it (kind "channel") if absent. */
  ensureChannel(name: string): VirtualChannel {
    const existingId = this.channelIdByName.get(name);
    if (existingId) return this.channels.get(existingId)!;
    return this.registerChannel(this.nextId(), name, "channel");
  }

  createThread(parentId: string, name: string): VirtualChannel {
    return this.registerChannel(this.nextId(), name, "thread", parentId);
  }

  getMember(id: string): VirtualMember | undefined {
    return this.members.get(id);
  }

  addMember(member: VirtualMember): void {
    this.members.set(member.id, member);
  }

  createMessage(channelId: string, init: CreateMessageInit): SimMessage {
    const message: SimMessage = {
      id: this.nextId(),
      channelId,
      authorId: init.authorId,
      authorKind: init.authorKind,
      content: init.content ?? "",
      embeds: init.embeds ?? [],
      components: init.components ?? [],
      reactions: [],
      createdAt: new Date().toISOString(),
      ephemeral: init.ephemeral,
      approvalId: init.approvalId,
    };
    this.messages.set(message.id, message);
    return message;
  }

  editMessage(channelId: string, messageId: string, patch: MessagePatch): SimMessage {
    const existing = this.messages.get(messageId) ?? this.adoptUnknown(channelId, messageId);
    if (patch.content !== undefined) existing.content = patch.content;
    if (patch.embeds !== undefined) existing.embeds = patch.embeds;
    if (patch.components !== undefined) existing.components = patch.components;
    existing.editedAt = new Date().toISOString();
    return existing;
  }

  /**
   * Materialize a record for a message id we never minted (e.g. a pre-created
   * placeholder adopted by id) so an edit has something to mutate.
   */
  private adoptUnknown(channelId: string, messageId: string): SimMessage {
    const message: SimMessage = {
      id: messageId,
      channelId,
      authorId: this.botUserId,
      authorKind: "bot",
      content: "",
      embeds: [],
      components: [],
      reactions: [],
      createdAt: new Date().toISOString(),
    };
    this.messages.set(messageId, message);
    return message;
  }

  getMessage(channelId: string, messageId: string): SimMessage | undefined {
    return this.messages.get(messageId);
  }

  /** Most-recent-first, like Discord's `getMessages`. */
  listMessages(channelId: string, limit = 50): SimMessage[] {
    return [...this.messages.values()]
      .filter((message) => message.channelId === channelId && !message.ephemeral)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  deleteMessage(channelId: string, messageId: string): void {
    this.messages.delete(messageId);
  }

  addReaction(channelId: string, messageId: string, emoji: string, byBot: boolean): void {
    const message = this.messages.get(messageId);
    if (!message) return;
    const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
    if (existing) {
      existing.count += 1;
      if (byBot) existing.me = true;
    } else {
      message.reactions.push({ emoji, count: 1, me: byBot });
    }
  }

  removeReaction(channelId: string, messageId: string, emoji: string, byBot: boolean): void {
    const message = this.messages.get(messageId);
    if (!message) return;
    const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
    if (!existing) return;
    existing.count -= 1;
    if (byBot) existing.me = false;
    if (existing.count <= 0) {
      message.reactions = message.reactions.filter((reaction) => reaction.emoji !== emoji);
    }
  }

  snapshot(): VirtualGuildSnapshot {
    return {
      guildId: this.guildId,
      botUserId: this.botUserId,
      channels: [...this.channels.values()],
      members: [...this.members.values()],
      roles: [...this.roles.values()],
      emojis: [...this.emojis.values()],
      messages: [...this.messages.values()].filter((message) => !message.ephemeral),
    };
  }
}
