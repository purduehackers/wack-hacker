import { SlashCommandBuilder } from "discord.js";
import { log } from "evlog";

import { defineCommand } from "@/bot/commands/define";
import { isOrganizer, respond } from "@/bot/commands/helpers";
import { env } from "@/env";

const FAILURE_MSG = "Failed to open the door. Try again later.";

export const doorOpener = defineCommand({
  builder: new SlashCommandBuilder()
    .setName("door-opener")
    .setDescription("Open the makerspace door (organizers only)"),
  async execute(ctx) {
    if (!isOrganizer(ctx)) {
      await respond(ctx, "You need the Organizer role to use this command.");
      return;
    }

    try {
      const res = await fetch(env.PHONEBELL_OPEN_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.PHACK_API_TOKEN}` },
      });

      if (!res.ok) {
        log.warn("door-opener", `Phonebell returned ${res.status}`);
        await respond(ctx, FAILURE_MSG);
        return;
      }

      await respond(ctx, "Door opened!");
    } catch (err) {
      log.warn("door-opener", `Phonebell request failed: ${String(err)}`);
      await respond(ctx, FAILURE_MSG);
    }
  },
});
