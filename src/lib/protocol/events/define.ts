import { z } from "zod";

import type { PacketEventSpec } from "./types.ts";

const PacketTimestamp = z.date();

// W3C trace context, stamped by the gateway relay so the queue consumer can
// join the relay's trace. Optional in both directions for rollout safety: old
// in-flight messages decode without it, and a consumer that ignores it still
// parses. Defined once here so every packet variant carries it uniformly.
const PacketTraceparent = z.string().optional();

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
      traceparent: PacketTraceparent,
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
