import { Vercel } from "@vercel/sdk";
import { SlashCommandBuilder } from "discord.js";
import { log } from "evlog";

import { env } from "@/env";
import { defineCommand } from "@/lib/bot/commands/define";
import { isOrganizer, respond } from "@/lib/bot/commands/helpers";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const DEFAULT_EMOJI = "\u{1F319}";

function stripLeadingEmoji(name: string): string {
  return name.replace(/^\p{Extended_Pictographic}/u, "");
}

async function updateEdgeConfig(version: string): Promise<void> {
  const vercel = new Vercel({ bearerToken: env.VERCEL_API_TOKEN });
  await vercel.edgeConfig.patchEdgeConfigItems({
    edgeConfigId: env.VERCEL_EDGE_CONFIG_ID,
    requestBody: {
      items: [{ operation: "upsert", key: "version", value: version }],
    },
  });

  log.info("hack-night", `Edge Config updated: version=${version}`);
}

export const initHackNight = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("init-hn")
    .setDescription("Initialize hack night (organizers only)")
    .addStringOption((opt) =>
      opt
        .setName("emoji")
        .setDescription("The emoji to use as the channel prefix")
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName("version")
        .setDescription("The semver version string (e.g. 6.17)")
        .setRequired(true),
    ),
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "Only organizers can run this command.");
      return;
    }

    const emoji = ctx.options.get("emoji") as string;
    const version = ctx.options.get("version") as string;
    const channelId = DISCORD_IDS.channels.HACK_NIGHT;

    const currentName = await ctx.discord.channels.get(channelId).then((ch) => ch.name ?? "");
    const newName = `${emoji}${stripLeadingEmoji(currentName)}`;
    await ctx.discord.channels.edit(channelId, { name: newName });
    await updateEdgeConfig(version);

    log.info("hack-night", `Initialized: ${currentName} → ${newName}, version=${version}`);
    await respond(ctx, `Hack night initialized!\n- Channel: ${newName}\n- Version: ${version}`);
  },
});

export const resetHackNight = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("reset-hn")
    .setDescription("Reset the hack night channel prefix to the moon emoji"),
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "Only organizers can run this command.");
      return;
    }

    const channelId = DISCORD_IDS.channels.HACK_NIGHT;

    const currentName = await ctx.discord.channels.get(channelId).then((ch) => ch.name ?? "");
    const newName = `${DEFAULT_EMOJI}${stripLeadingEmoji(currentName)}`;
    await ctx.discord.channels.edit(channelId, { name: newName });

    log.info("hack-night", `Reset: ${currentName} → ${newName}`);
    await respond(ctx, `Hack night reset! Channel: ${newName}`);
  },
});
