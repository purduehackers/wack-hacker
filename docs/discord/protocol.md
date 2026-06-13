# Protocol

The protocol layer is the thin boundary between Discord's over-the-wire format and the typed `Packet` values the rest of the codebase uses.

## The event table

`src/lib/protocol/events/` owns everything event-shaped. Each gateway event is one module created with `definePacketEvent`, declaring four things in one place:

```ts
// src/lib/protocol/events/message-delete.ts
export const messageDeleteEvent = definePacketEvent({
  type: "GATEWAY_MESSAGE_DELETE", // wire discriminator — never change on a live queue
  kind: "messageDelete", //          handler-facing kind for defineEvent({ type: ... })
  data: MessageDeleteData, //        zod schema for the packet's data field
  dedupKey: (packet) => `del:${packet.data.id}`, // Discord-native IDs only — no wall-clock
  bind: (client, publish) => {
    /* discord.js listener + serialization */
  },
});
```

`events/index.ts` lists the modules in the `packetEvents` table and derives the rest: `getDedupKey` (used by the inbound consumer), `bindGatewayEvents` (used by the gateway route), `kindOfPacketType` (used by the router), and the `PacketEventKind`/`PacketForKind` types behind `defineEvent`.

The union today:

```
GATEWAY_MESSAGE_CREATE            kind: message
GATEWAY_MESSAGE_REACTION_ADD      kind: reactionAdd
GATEWAY_MESSAGE_REACTION_REMOVE   kind: reactionRemove
GATEWAY_MESSAGE_DELETE            kind: messageDelete
```

**Adding an event** means two new files: the protocol module above (plus its line in the `packetEvents` table) and a bot handler under `src/bot/handlers/events/` (plus its barrel line) — the schema union, dedup, gateway binding, and router kind all follow from the table. Compare with the seven files this used to take.

**Dedup keys must come from Discord-native IDs.** A wall-clock component (relay time) makes every dual-leader duplicate look unique and defeats dedup entirely — that bug is why the old `MESSAGE_UPDATE`/`VOICE_STATE_UPDATE` packets were deleted rather than kept.

**Wire compatibility:** in-flight queue messages from the previous deploy must still decode. New fields must be zod-optional; never rename `type` values. Removed packet types fail decode on the consumer, which drops them with a `discord.event.decode_failed` metric instead of retrying.

## Packets

`src/lib/protocol/packets.ts` derives `PacketSchema` (a Zod discriminated union over the table's packet schemas) and `PacketCodec`, a `z.codec(z.string(), PacketSchema, ...)` that transparently handles the `timestamp` `Date` rehydration on decode:

```ts
PacketCodec.encode(packet); // → JSON string
PacketCodec.decode(rawJson); // → Packet (timestamp is a Date, not a string)
```

Both ends of the queue use this — the gateway listener calls `encode` before `send(DISCORD_EVENT_TOPIC, ...)`, and the inbound consumer calls `decode` before dispatching to the router.

## Interaction verification

`src/lib/protocol/verify.ts` exports `verifyInteraction(request, publicKey)`:

```ts
async function verifyInteraction(
  request: Request,
  publicKey: string,
): Promise<{ valid: true; body: unknown } | { valid: false }>;
```

It extracts `X-Signature-Ed25519` and `X-Signature-Timestamp`, reads the raw body, runs them through `discord-interactions` `verifyKey`, and returns a discriminated result. Only on `valid: true` does the body get parsed and returned.

The interactions route calls this **before** parsing or dispatching, so an unsigned request can never reach a handler:

```ts
const result = await verifyInteraction(c.req.raw, env.DISCORD_BOT_PUBLIC_KEY);
if (!result.valid) return c.json({ error: "Invalid signature" }, 401);
```

## Types and constants

- `src/lib/protocol/types.ts` — the TypeScript types (`Packet`, `MessageCreatePacketType`, `DiscordInteraction`, …).
- `src/lib/protocol/events/types.ts` — the event-table types (`PacketEventSpec`, `PacketEventKind`, `PacketForKind`).
- `src/lib/protocol/constants.ts` — `InteractionType`, `InteractionResponseType`, `DISCORD_IDS`.
- `src/lib/protocol/utils.ts` — small helpers (e.g. `isTextChannel`).
