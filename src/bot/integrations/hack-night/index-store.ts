import { del } from "@vercel/blob";
import { and, asc, eq } from "drizzle-orm";
import { log } from "evlog";

import { getDb } from "@/lib/db";
import { hackNightImages } from "@/lib/db/schemas/hack-night-images";

import type { EventIndex, ImageMetadata } from "./types";

export async function getEventIndex(eventSlug: string): Promise<EventIndex | null> {
  const db = getDb();
  const rows = await db
    .select({
      filename: hackNightImages.filename,
      uploadedAt: hackNightImages.uploadedAt,
      discordMessageId: hackNightImages.discordMessageId,
      discordUserId: hackNightImages.discordUserId,
    })
    .from(hackNightImages)
    .where(eq(hackNightImages.eventSlug, eventSlug))
    .orderBy(asc(hackNightImages.uploadedAt));

  if (rows.length === 0) return null;

  const lastUpdated = rows.reduce(
    (max, entry) => (entry.uploadedAt > max ? entry.uploadedAt : max),
    rows[0]!.uploadedAt,
  );

  return { eventSlug, lastUpdated, images: rows };
}

export async function updateEventIndex(eventSlug: string, images: ImageMetadata[]): Promise<void> {
  if (images.length === 0) return;

  const db = getDb();
  await db
    .insert(hackNightImages)
    .values(
      images.map((img) => ({
        eventSlug,
        filename: img.filename,
        uploadedAt: img.uploadedAt,
        discordMessageId: img.discordMessageId,
        discordUserId: img.discordUserId,
      })),
    )
    .onConflictDoNothing();

  log.info("hack-night", `Indexed ${images.length} image(s) for ${eventSlug}`);
}

export async function removeImagesForMessage(
  eventSlug: string,
  discordMessageId: string,
  blobToken: string,
): Promise<number> {
  const db = getDb();
  const removed = await db
    .delete(hackNightImages)
    .where(
      and(
        eq(hackNightImages.eventSlug, eventSlug),
        eq(hackNightImages.discordMessageId, discordMessageId),
      ),
    )
    .returning({ filename: hackNightImages.filename });

  if (removed.length === 0) return 0;

  await del(
    removed.map((row) => `images/${eventSlug}/${row.filename}`),
    { token: blobToken },
  );
  return removed.length;
}
