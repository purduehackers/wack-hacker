import type { APIMessage } from "discord-api-types/v10";
import type { z } from "zod";

import type { InteractionType } from "./constants";
import type { PacketSchema } from "./packets";

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
  id?: string;
  name?: string;
  type?: number;
  options?: InteractionOption[];
  custom_id?: string;
  component_type?: number;
  target_id?: string;
  resolved?: InteractionResolved;
  components?: ModalActionRow[];
}

export interface ModalActionRow {
  type: number;
  components: ModalSubmitComponent[];
}

export interface ModalSubmitComponent {
  type: number;
  custom_id: string;
  value: string;
}

export interface InteractionResolved {
  messages?: Record<string, APIMessage>;
  users?: Record<
    string,
    { id: string; username: string; global_name?: string | null; bot?: boolean }
  >;
}

export interface InteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
}

export type Packet = z.infer<typeof PacketSchema>;
export type MessageCreatePacketType = Extract<Packet, { type: "GATEWAY_MESSAGE_CREATE" }>;
export type MessageReactionAddPacketType = Extract<
  Packet,
  { type: "GATEWAY_MESSAGE_REACTION_ADD" }
>;
export type MessageReactionRemovePacketType = Extract<
  Packet,
  { type: "GATEWAY_MESSAGE_REACTION_REMOVE" }
>;
