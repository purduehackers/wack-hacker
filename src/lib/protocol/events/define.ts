import { z } from "zod";

import type { PacketEventSpec } from "./types.ts";

const PacketTimestamp = z.date();

export function definePacketEvent<
  TType extends string,
  TKind extends string,
  TData extends z.ZodType,
>(spec: PacketEventSpec<TType, TKind, TData>) {
  return {
    ...spec,
    packet: z.object({
      type: z.literal(spec.type),
      timestamp: PacketTimestamp,
      data: spec.data,
    }),
  };
}

/** Assemble the event table as a typed tuple (rest params preserve each member's literal types). */
export function packetEventTable<
  T extends readonly { type: string; kind: string; packet: z.ZodType }[],
>(...events: T): T {
  return events;
}
