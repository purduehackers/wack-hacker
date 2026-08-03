import { NotFound } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "./define.ts";

/** Discord's epoch, the offset every snowflake timestamp is relative to. */
const DISCORD_EPOCH = 1_420_070_400_000n;

/**
 * Milliseconds between Discord minting the interaction and us reading it.
 *
 * Derived from the snowflake rather than measured against our own clock, because
 * the interesting number is how long the round trip took, and our clock and
 * Discord's are not the same clock.
 */
export function latencyFromSnowflake(id: string, now: number): Result<number, NotFound> {
  // Parsed as a BigInt throughout: a real snowflake is a 64-bit value well past
  // Number.MAX_SAFE_INTEGER, so any Number-based validation rejects all of them.
  if (!/^\d+$/.test(id)) return Result.err(new NotFound({ kind: "snowflake", id }));

  const raw = BigInt(id);
  if (raw <= 0n) return Result.err(new NotFound({ kind: "snowflake", id }));

  return Result.ok(now - Number((raw >> 22n) + DISCORD_EPOCH));
}

export const ping = defineCommand({
  builder: new SlashCommandBuilder().setName("ping").setDescription("Health check"),
  execute: async (interaction) => {
    const latency = latencyFromSnowflake(interaction.id, Date.now());
    const websocket = Math.round(interaction.client.ws.ping);

    const body = Result.match(latency, {
      ok: (roundTripMs) => `pong — ${roundTripMs}ms round trip, ${websocket}ms gateway`,
      // A snowflake we cannot parse is not worth failing the command over; the
      // gateway ping alone still answers "is the bot alive".
      err: () => `pong — ${websocket}ms gateway`,
    });

    await interaction.reply(body);
    return Result.ok(undefined);
  },
});
