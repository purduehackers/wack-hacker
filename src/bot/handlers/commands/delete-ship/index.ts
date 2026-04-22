import { SlashCommandBuilder } from "discord.js";

import { defineCommand } from "@/bot/commands/define";
import { isOrganizer, respond } from "@/bot/commands/helpers";
import { ShipsClient } from "@/bot/integrations/ships";
import { env } from "@/env";

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

    const ships = new ShipsClient(env.SHIP_API_KEY);
    const result = await ships.deleteShipByMessageId(messageId);

    if (!result.deleted) {
      await respond(ctx, `No ship found for message ID \`${messageId}\`.`);
      return;
    }

    await respond(
      ctx,
      `Ship with message ID \`${messageId}\` has been deleted from the gallery (${result.attachmentsRemoved} attachments removed).`,
    );
  },
});
