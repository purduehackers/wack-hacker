import type { APIMessage } from "discord-api-types/v10";

import type { InteractionType } from "./enums";

export type DiscordMessage = APIMessage;

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: InteractionType;
  token: string;
  version: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    user: { id: string; username: string; bot?: boolean };
    roles: string[];
    nick?: string | null;
  };
  user?: { id: string; username: string; bot?: boolean };
  data?: InteractionData;
}

export interface InteractionData {
  id: string;
  name: string;
  type?: number;
  options?: InteractionOption[];
  custom_id?: string;
  component_type?: number;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

import type { z } from "zod";

import type {
  PacketSchema,
  MessageCreatePacket,
  MessageReactionAddPacket,
  MessageReactionRemovePacket,
  MessageDeletePacket,
  MessageUpdatePacket,
  VoiceStateUpdatePacket,
  ThreadCreatePacket,
} from "./packets";

export type Packet = z.infer<typeof PacketSchema>;
export type MessageCreatePacketType = z.infer<typeof MessageCreatePacket>;
export type MessageReactionAddPacketType = z.infer<typeof MessageReactionAddPacket>;
export type MessageReactionRemovePacketType = z.infer<typeof MessageReactionRemovePacket>;
export type MessageDeletePacketType = z.infer<typeof MessageDeletePacket>;
export type MessageUpdatePacketType = z.infer<typeof MessageUpdatePacket>;
export type VoiceStateUpdatePacketType = z.infer<typeof VoiceStateUpdatePacket>;
export type ThreadCreatePacketType = z.infer<typeof ThreadCreatePacket>;
