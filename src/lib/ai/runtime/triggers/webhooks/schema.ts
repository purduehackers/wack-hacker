import { z } from "zod";

/** A timestamp representing the time the packet was received. */
const PacketTimestamp = z.date();

/**
 * A timestamp representing the time the message was sent.
 * Discord uses ISO 8601 datetime strings with timezone offset.
 */
const DiscordTimestamp = z.iso.datetime({ offset: true });

export const PacketTypeMessageCreate = z.literal("GATEWAY_MESSAGE_CREATE");

/**
 * Represents an attachment in a message.
 */
export const MessageDataAttachment = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
  size: z.number(),
});

/**
 * Represents the author of a message.
 */
export const MessageDataAuthor = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().optional(),
  bot: z.boolean().optional(),
});

/**
 * Represents a channel in a message.
 */
export const MessageDataChannel = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * Represents a thread in a message.
 */
export const MessageDataThread = MessageDataChannel.extend({
  parentId: z.string(),
});

/**
 * Represents a message.
 */
export const MessageData = z.object({
  id: z.string(),
  attachments: z.array(MessageDataAttachment),
  author: MessageDataAuthor,
  channel: MessageDataChannel,
  thread: MessageDataThread.optional(),
  guildId: z.string(),
  content: z.string(),
  timestamp: DiscordTimestamp,
});

/**
 * Represents a packet containing a message create event.
 */
export const MessageCreatePacket = z.object({
  type: PacketTypeMessageCreate,
  timestamp: PacketTimestamp,
  data: MessageData,
});

export const PacketTypeMessageReactionAdd = z.literal(
  "GATEWAY_MESSAGE_REACTION_ADD",
);
export const PacketTypeMessageReactionRemove = z.literal(
  "GATEWAY_MESSAGE_REACTION_REMOVE",
);

/**
 * Represents an emoji in a reaction.
 */
export const ReactionDataEmoji = z.object({
  id: z.string(),
  name: z.string(),
});

/**
 * Represents a user in a reaction.
 */
export const ReactionDataUser = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string(),
  bot: z.boolean(),
});

/**
 * Represents a reaction.
 */
export const ReactionData = z.object({
  messageId: z.string(),
  guildId: z.string(),
  emoji: ReactionDataEmoji,
  creator: ReactionDataUser,
});

/**
 * Represents a packet containing a message reaction add event.
 */
export const MessageReactionAddPacket = z.object({
  type: PacketTypeMessageReactionAdd,
  timestamp: PacketTimestamp,
  data: ReactionData,
});

/**
 * Represents a packet containing a message reaction remove event.
 */
export const MessageReactionRemovePacket = z.object({
  type: PacketTypeMessageReactionRemove,
  timestamp: PacketTimestamp,
  data: ReactionData,
});

/**
 * Canonical schema for webhook packets.
 */
export const PacketSchema = z.discriminatedUnion("type", [
  MessageCreatePacket,
  MessageReactionAddPacket,
  MessageReactionRemovePacket,
]);

/**
 * Type representing a webhook packet.
 */
export type Packet = z.infer<typeof PacketSchema>;

/**
 * Codec for encoding/decoding webhook packets.
 *
 * @example
 * ```ts
 * const packet = PacketCodec.decode(json);
 * const json = PacketCodec.encode(packet);
 * ```
 */
export const PacketCodec = z.codec(z.string(), PacketSchema, {
  decode: (json) => JSON.parse(json),
  encode: (packet) => JSON.stringify(packet),
});
