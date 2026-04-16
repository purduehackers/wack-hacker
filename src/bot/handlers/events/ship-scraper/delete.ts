import { log } from "evlog";

import { defineEvent } from "@/bot/events/define";
import { R2Storage } from "@/bot/integrations/r2";
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
        const r2 = new R2Storage(
          env.R2_ACCOUNT_ID,
          env.R2_ACCESS_KEY_ID,
          env.R2_SECRET_ACCESS_KEY,
          env.SHIP_R2_BUCKET_NAME,
        );
        for (const key of deleted.attachmentKeys) {
          await r2.deleteKey(key);
        }
        log.info(
          "ship-scraper",
          `Cleaned up ${deleted.attachmentKeys.length} R2 objects for ship ${deleted.id}`,
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
