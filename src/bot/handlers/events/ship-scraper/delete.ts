import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { ShipsClient } from "@/bot/integrations/ships";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const shipMessageDelete = defineEvent({
  type: "messageDelete",
  async handle(packet) {
    if (packet.data.channelId !== DISCORD_IDS.channels.SHIP) return;

    const ships = new ShipsClient(env.SHIP_API_KEY);

    try {
      const result = await ships.deleteShipByMessageId(packet.data.id);
      if (!result.deleted) return;

      log.info(
        "ship-scraper",
        `Deleted ship ${result.id ?? "?"} (message ${packet.data.id}, ${result.attachmentsRemoved} attachments)`,
      );
    } catch (err) {
      log.warn(
        "ship-scraper",
        `Failed to delete ship for message ${packet.data.id}: ${String(err)}`,
      );
    }
  },
});
