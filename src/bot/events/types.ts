import type { PacketEventKind, PacketForKind } from "@/lib/protocol/events";
import type { MessageCreatePacketType } from "@/lib/protocol/types";

import type { HandlerContext } from "../types";

/**
 * Everything a handler can subscribe to: one kind per packet event in the
 * protocol table, plus "mention" — a derived kind for MESSAGE_CREATE packets
 * that lead with an @-mention of the bot (or reply to it in a thread).
 */
export type HandlerKind = PacketEventKind | "mention";

export type PacketForHandlerKind<K extends HandlerKind> = K extends PacketEventKind
  ? PacketForKind<K>
  : MessageCreatePacketType;

export type EventHandler = {
  [K in HandlerKind]: {
    type: K;
    handle(packet: PacketForHandlerKind<K>, ctx: HandlerContext): Promise<void>;
  };
}[HandlerKind];
