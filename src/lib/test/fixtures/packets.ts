import type {
  MessageCreatePacketType,
  MessageReactionAddPacketType,
  MessageReactionRemovePacketType,
  Packet,
} from "@/lib/protocol/types";

export function messagePacket(
  content: string,
  overrides: Record<string, unknown> = {},
): MessageCreatePacketType {
  return {
    type: "GATEWAY_MESSAGE_CREATE",
    timestamp: new Date("2024-01-01"),
    data: {
      id: "msg-1",
      attachments: [],
      author: { id: "user-1", username: "alice" },
      channel: { id: "ch-1", name: "general" },
      guildId: "guild-1",
      content,
      timestamp: "2024-01-01T00:00:00.000+00:00",
      ...overrides,
    },
  };
}

export function reactionPacket(
  emoji: string,
  type: "GATEWAY_MESSAGE_REACTION_REMOVE",
): MessageReactionRemovePacketType;
export function reactionPacket(
  emoji: string,
  type?: "GATEWAY_MESSAGE_REACTION_ADD",
): MessageReactionAddPacketType;
export function reactionPacket(
  emoji: string,
  type:
    | "GATEWAY_MESSAGE_REACTION_ADD"
    | "GATEWAY_MESSAGE_REACTION_REMOVE" = "GATEWAY_MESSAGE_REACTION_ADD",
): MessageReactionAddPacketType | MessageReactionRemovePacketType {
  return {
    type,
    timestamp: new Date("2024-01-01"),
    data: {
      messageId: "msg-1",
      channelId: "ch-1",
      guildId: "guild-1",
      emoji: { id: null, name: emoji },
      creator: { id: "user-1", username: "alice" },
    },
  };
}

export function messageUpdatePacket(): Packet {
  return {
    type: "GATEWAY_MESSAGE_UPDATE",
    timestamp: new Date("2024-01-01"),
    data: {
      id: "msg-1",
      channelId: "ch-1",
      guildId: "guild-1",
    },
  };
}

export function deletePacket(): Packet {
  return {
    type: "GATEWAY_MESSAGE_DELETE",
    timestamp: new Date("2024-01-01"),
    data: { id: "msg-1", channelId: "ch-1", guildId: "guild-1" },
  };
}

export function voiceStatePacket(channelId: string | null = "vc-1"): Packet {
  return {
    type: "GATEWAY_VOICE_STATE_UPDATE",
    timestamp: new Date("2024-01-01"),
    data: {
      userId: "user-1",
      guildId: "guild-1",
      channelId,
      sessionId: "sess-1",
      selfMute: false,
      selfDeaf: false,
    },
  };
}

export function threadCreatePacket(): Packet {
  return {
    type: "GATEWAY_THREAD_CREATE",
    timestamp: new Date("2024-01-01"),
    data: {
      id: "thread-1",
      name: "my-thread",
      parentId: "ch-1",
      guildId: "guild-1",
      ownerId: "user-1",
    },
  };
}
