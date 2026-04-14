import { SlashCommandBuilder } from "discord.js";

import { env } from "@/env";
import { defineCommand } from "@/lib/bot/commands/define";
import { isOrganizer, respond } from "@/lib/bot/commands/helpers";
import { ShipDatabase } from "@/lib/bot/integrations/ships";

export const deleteShip = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("delete-ship")
    .setDescription("Delete a ship from the gallery website (organizers only)")
    .addStringOption((opt) =>
      opt
        .setName("message_id")
        .setDescription("The Discord message ID of the ship to delete")
        .setRequired(true),
    ),
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "You must be an organizer to use this command.");
      return;
    }

    const messageId = ctx.options.get("message_id") as string;
    if (!messageId) {
      await respond(ctx, "Please provide a message_id.");
      return;
    }

    const shipDb = new ShipDatabase(env.SHIP_DATABASE_TURSO_DATABASE_URL, env.SHIP_DATABASE_TURSO_AUTH_TOKEN);
    await shipDb.deleteByMessageId(messageId);
    await respond(ctx, `Ship with message ID \`${messageId}\` has been deleted from the gallery.`);
  },
});
