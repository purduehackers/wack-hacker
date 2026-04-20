import { del } from "@vercel/blob";
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

    try {
      const deleted = await shipDb.deleteByMessageId(packet.data.id);
      if (!deleted) return;

      log.info("ship-scraper", `Deleted ship ${deleted.id} (message ${packet.data.id})`);

      if (deleted.attachmentKeys.length > 0) {
        await del(deleted.attachmentKeys, { token: env.SHIPS_BLOB_READ_WRITE_TOKEN });
        log.info(
          "ship-scraper",
          `Cleaned up ${deleted.attachmentKeys.length} blobs for ship ${deleted.id}`,
        );
      }
    } catch (err) {
      log.warn(
        "ship-scraper",
        `Failed to delete ship for message ${packet.data.id}: ${String(err)}`,
      );
    }
  },
});
