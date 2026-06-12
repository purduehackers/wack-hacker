import { z } from "zod";

import { packetEvents } from "./events/index.ts";

// The union and codec derive from the event table — adding an event module to
// `events/index.ts` extends the wire schema without touching this file.
// The generic indirection matters: TS only applies the tuple-preserving
// array-mapped special case to type parameters, so mapping the concrete
// `typeof packetEvents` directly would degrade the union to unknown.
function toSchemaTuple<T extends readonly { packet: z.ZodType }[]>(eventDefs: T) {
  return eventDefs.map((entry) => entry.packet) as {
    [K in keyof T]: T[K] extends { packet: infer P } ? P : never;
  };
}

export const PacketSchema = z.discriminatedUnion("type", toSchemaTuple(packetEvents));

export const PacketCodec = z.codec(z.string(), PacketSchema, {
  decode: (json) => {
    const parsed = JSON.parse(json);
    parsed.timestamp = new Date(parsed.timestamp);
    return parsed;
  },
  encode: (packet) => JSON.stringify(packet),
});
