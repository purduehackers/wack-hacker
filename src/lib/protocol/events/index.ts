import type { Client } from "discord.js";

import type { Packet } from "../types.ts";
import type { PacketEvent, PacketEventKind } from "./types.ts";

import { packetEventTable } from "./define.ts";
import { messageCreateEvent } from "./message-create.ts";
import { messageDeleteEvent } from "./message-delete.ts";
import { reactionAddEvent, reactionRemoveEvent } from "./reactions.ts";

export { definePacketEvent } from "./define.ts";
export type {
  PacketEvent,
  PacketEventKind,
  PacketEventSpec,
  PacketForKind,
  PacketOf,
} from "./types.ts";

/**
 * The gateway event table. Everything event-shaped derives from here: the
 * packet union (`PacketSchema` in ../packets.ts), queue dedup keys, the
 * gateway's discord.js bindings, and the router's handler kinds. To add an
 * event, create its module and list it here; to remove one, delete both.
 */
export const packetEvents = packetEventTable(
  messageCreateEvent,
  reactionAddEvent,
  reactionRemoveEvent,
  messageDeleteEvent,
);

const byType = Object.fromEntries(packetEvents.map((event) => [event.type, event])) as Record<
  Packet["type"],
  PacketEvent
>;

export function kindOfPacketType(type: Packet["type"]): PacketEventKind {
  return byType[type].kind;
}

export function getDedupKey(packet: Packet): string {
  // The table guarantees the packet matches its own event's data schema; the
  // cast bridges the union members the lookup can't correlate.
  return byType[packet.type].dedupKey(packet as never);
}

/** Attach every event's discord.js listener to the gateway client. */
export function bindGatewayEvents(
  client: Client,
  publish: (packet: Packet) => Promise<void>,
): void {
  for (const event of packetEvents) {
    (event.bind as (c: Client, p: (packet: Packet) => Promise<void>) => void)(client, publish);
  }
}
