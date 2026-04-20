import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const hackNightImages = sqliteTable(
  "hack_night_images",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventSlug: text("event_slug").notNull(),
    filename: text("filename").notNull(),
    uploadedAt: text("uploaded_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    discordMessageId: text("discord_message_id").notNull(),
    discordUserId: text("discord_user_id").notNull(),
  },
  (table) => [
    uniqueIndex("hack_night_images_slug_filename_uq").on(table.eventSlug, table.filename),
    index("hack_night_images_slug_idx").on(table.eventSlug),
    index("hack_night_images_message_idx").on(table.discordMessageId),
  ],
);
