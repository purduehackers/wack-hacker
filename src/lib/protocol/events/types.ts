import type { Client } from "discord.js";
import type { z } from "zod";

import type { packetEvents } from "./index.ts";

/** The decoded packet shape for one event definition. */
export interface PacketOf<TType extends string, TData extends z.ZodType> {
  type: TType;
  timestamp: Date;
  data: z.output<TData>;
}

/**
 * One gateway event, defined in a single module: wire schema, dedup key, and
 * the discord.js listener that serializes and publishes it. Everything else —
 * the packet union, dedup lookup, and gateway bindings — derives from the
 * table of these in `events/index.ts`, so adding an event means one protocol
 * module plus one bot handler file.
 */
export interface PacketEventSpec<
  TType extends string,
  TKind extends string,
  TData extends z.ZodType,
> {
  /** Wire discriminator (e.g. "GATEWAY_MESSAGE_CREATE"). Never change on a live queue. */
  type: TType;
  /** Handler-facing kind used in `defineEvent({ type: ... })` registrations. */
  kind: TKind;
  data: TData;
  /**
   * Queue-dedup key. Use Discord-native IDs only — never wall-clock values,
   * which would defeat dedup across dual-leader gateway overlap.
   */
  dedupKey: (packet: PacketOf<TType, TData>) => string;
  /** Attach the discord.js listener(s) that serialize and publish this packet. */
  bind: (client: Client, publish: (packet: PacketOf<TType, TData>) => Promise<void>) => void;
}

export type PacketEvent = (typeof packetEvents)[number];
export type PacketEventKind = PacketEvent["kind"];

/** The decoded packet type for a handler kind (e.g. "reactionAdd"). */
export type PacketForKind<K extends PacketEventKind> = z.infer<
  Extract<PacketEvent, { kind: K }>["packet"]
>;
