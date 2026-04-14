import type {
  MessageCreatePacketType,
  MessageReactionAddPacketType,
  MessageReactionRemovePacketType,
  MessageDeletePacketType,
  MessageUpdatePacketType,
  VoiceStateUpdatePacketType,
  ThreadCreatePacketType,
} from "@/lib/protocol/types";

import type { HandlerContext } from "../types";

export type EventHandler =
  | { type: "message"; handle(packet: MessageCreatePacketType, ctx: HandlerContext): Promise<void> }
  | {
      type: "reactionAdd";
      handle(packet: MessageReactionAddPacketType, ctx: HandlerContext): Promise<void>;
    }
  | {
      type: "reactionRemove";
      handle(packet: MessageReactionRemovePacketType, ctx: HandlerContext): Promise<void>;
    }
  | {
      type: "messageDelete";
      handle(packet: MessageDeletePacketType, ctx: HandlerContext): Promise<void>;
    }
  | {
      type: "messageUpdate";
      handle(packet: MessageUpdatePacketType, ctx: HandlerContext): Promise<void>;
    }
  | {
      type: "voiceStateUpdate";
      handle(packet: VoiceStateUpdatePacketType, ctx: HandlerContext): Promise<void>;
    }
  | {
      type: "threadCreate";
      handle(packet: ThreadCreatePacketType, ctx: HandlerContext): Promise<void>;
    };
