import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { ShipDatabase } from "@/bot/integrations/ships";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

export const shipMessageDelete = defineEvent({
  type: "messageDelete",
  async handle(packet) {
    if (packet.data.channelId !== DISCORD_IDS.channels.SHIP) return;

    const shipDb = new ShipDatabase(
      env.SHIP_DATABASE_TURSO_DATABASE_URL,
      env.SHIP_DATABASE_TURSO_AUTH_TOKEN,
    );

    const deletedId = await shipDb.deleteByMessageId(packet.data.id);

    if (deletedId) {
      log.info("ship-scraper", `Deleted ship ${deletedId} (message ${packet.data.id})`);
    }
  },
});
