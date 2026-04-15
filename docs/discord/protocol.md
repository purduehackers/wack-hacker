# Protocol

The protocol layer is the thin boundary between Discord's over-the-wire format and the typed `Packet` values the rest of the codebase uses.

## Packets

`src/lib/protocol/packets.ts` defines the `Packet` type as a Zod-validated discriminated union over event types. Each variant has a `type` (literal `"GATEWAY_*"`), a `timestamp` (`Date`), and a `data` field whose shape depends on the type.

The union:

```
GATEWAY_MESSAGE_CREATE            MessageCreatePacket
GATEWAY_MESSAGE_REACTION_ADD      MessageReactionAddPacket
GATEWAY_MESSAGE_REACTION_REMOVE   MessageReactionRemovePacket
GATEWAY_MESSAGE_DELETE            MessageDeletePacket
GATEWAY_MESSAGE_UPDATE            MessageUpdatePacket
GATEWAY_VOICE_STATE_UPDATE        VoiceStateUpdatePacket
GATEWAY_THREAD_CREATE             ThreadCreatePacket
```

`PacketSchema` is the discriminated union, and `PacketCodec` is a `z.codec(z.string(), PacketSchema, ...)` that transparently handles the `timestamp` `Date` rehydration on decode:

```ts
PacketCodec.encode(packet)  // → JSON string
PacketCodec.decode(rawJson) // → Packet (timestamp is a Date, not a string)
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
const result = await verifyInteraction(c.req.raw, env.DISCORD_PUBLIC_KEY);
if (!result.valid) return c.json({ error: "Invalid signature" }, 401);
```

## Types and constants

- `src/lib/protocol/types.ts` — the TypeScript types (`Packet`, `MessageCreatePacketType`, `DiscordInteraction`, …).
- `src/lib/protocol/constants.ts` — `InteractionType`, `InteractionResponseType`, `DISCORD_IDS`.
- `src/lib/protocol/utils.ts` — small helpers (e.g. `isTextChannel`).
