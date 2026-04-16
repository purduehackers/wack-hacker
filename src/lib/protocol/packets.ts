import { z } from "zod";

const PacketTimestamp = z.date();
const DiscordTimestamp = z.iso.datetime({ offset: true });

const MessageDataAttachment = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
  size: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const MessageDataAuthor = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().optional(),
  bot: z.boolean().optional(),
  avatarHash: z.string().optional(),
});

const MessageDataChannel = z.object({
  id: z.string(),
  name: z.string(),
});

const MessageDataThread = z.object({
  parentId: z.string(),
  parentName: z.string(),
});

const MessageSnapshot = z.object({
  content: z.string().optional(),
  attachments: z.array(MessageDataAttachment).optional(),
});

const MessageData = z.object({
  id: z.string(),
  attachments: z.array(MessageDataAttachment),
  author: MessageDataAuthor,
  channel: MessageDataChannel,
  thread: MessageDataThread.optional(),
  guildId: z.string(),
  content: z.string(),
  timestamp: DiscordTimestamp,
  memberRoles: z.array(z.string()).optional(),
  flags: z.number().optional(),
  categoryId: z.string().optional(),
  forwardedSnapshots: z.array(MessageSnapshot).optional(),
});

const ReactionDataEmoji = z.object({
  id: z.string().nullable(),
  name: z.string(),
});

const ReactionDataUser = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().optional(),
  bot: z.boolean().optional(),
});

const ReactionData = z.object({
  messageId: z.string(),
  channelId: z.string(),
  guildId: z.string(),
  emoji: ReactionDataEmoji,
  creator: ReactionDataUser,
});

const MessageDeleteData = z.object({
  id: z.string(),
  channelId: z.string(),
  guildId: z.string(),
});

// ── Packets ──

export const MessageCreatePacket = z.object({
  type: z.literal("GATEWAY_MESSAGE_CREATE"),
  timestamp: PacketTimestamp,
  data: MessageData,
});

export const MessageReactionAddPacket = z.object({
  type: z.literal("GATEWAY_MESSAGE_REACTION_ADD"),
  timestamp: PacketTimestamp,
  data: ReactionData,
});

export const MessageReactionRemovePacket = z.object({
  type: z.literal("GATEWAY_MESSAGE_REACTION_REMOVE"),
  timestamp: PacketTimestamp,
  data: ReactionData,
});

export const MessageDeletePacket = z.object({
  type: z.literal("GATEWAY_MESSAGE_DELETE"),
  timestamp: PacketTimestamp,
  data: MessageDeleteData,
});

export const MessageUpdatePacket = z.object({
  type: z.literal("GATEWAY_MESSAGE_UPDATE"),
  timestamp: PacketTimestamp,
  data: MessageData.partial().extend({
    id: z.string(),
    channelId: z.string(),
    guildId: z.string(),
  }),
});

// ── Voice State ──

const VoiceStateData = z.object({
  userId: z.string(),
  guildId: z.string(),
  channelId: z.string().nullable(),
  sessionId: z.string(),
  selfMute: z.boolean(),
  selfDeaf: z.boolean(),
});

export const VoiceStateUpdatePacket = z.object({
  type: z.literal("GATEWAY_VOICE_STATE_UPDATE"),
  timestamp: PacketTimestamp,
  data: VoiceStateData,
});

// ── Thread Create ──

const ThreadCreateData = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string(),
  guildId: z.string(),
  ownerId: z.string(),
});

export const ThreadCreatePacket = z.object({
  type: z.literal("GATEWAY_THREAD_CREATE"),
  timestamp: PacketTimestamp,
  data: ThreadCreateData,
});

// ── Schema + types ──

export const PacketSchema = z.discriminatedUnion("type", [
  MessageCreatePacket,
  MessageReactionAddPacket,
  MessageReactionRemovePacket,
  MessageDeletePacket,
  MessageUpdatePacket,
  VoiceStateUpdatePacket,
  ThreadCreatePacket,
]);

export const PacketCodec = z.codec(z.string(), PacketSchema, {
  decode: (json) => {
    const parsed = JSON.parse(json);
    parsed.timestamp = new Date(parsed.timestamp);
    return parsed;
  },
  encode: (packet) => JSON.stringify(packet),
});
