import { BlobNotFoundError, del, head, put } from "@vercel/blob";
import { log } from "evlog";

import type { EventIndex, ImageMetadata } from "./types";

function indexKey(eventSlug: string): string {
  return `images/${eventSlug}/index.json`;
}

export async function getEventIndex(eventSlug: string, token: string): Promise<EventIndex | null> {
  try {
    const meta = await head(indexKey(eventSlug), { token });
    const res = await fetch(meta.url);
    if (!res.ok) throw new Error(`event index fetch failed: ${res.status}`);
    return (await res.json()) as EventIndex;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

async function writeEventIndex(eventSlug: string, index: EventIndex, token: string): Promise<void> {
  await put(indexKey(eventSlug), JSON.stringify(index, null, 2), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });
}

export async function updateEventIndex(
  eventSlug: string,
  image: ImageMetadata,
  token: string,
): Promise<void> {
  const existing = (await getEventIndex(eventSlug, token)) ?? {
    eventSlug,
    lastUpdated: new Date().toISOString(),
    images: [],
  };

  existing.images.push(image);
  existing.lastUpdated = new Date().toISOString();
  await writeEventIndex(eventSlug, existing, token);

  log.info("hack-night", `Updated index for ${eventSlug}: ${existing.images.length} images`);
}

export async function removeImagesForMessage(
  eventSlug: string,
  discordMessageId: string,
  token: string,
): Promise<number> {
  const index = await getEventIndex(eventSlug, token);
  if (!index) return 0;

  const toRemove = index.images.filter((img) => img.discordMessageId === discordMessageId);
  if (toRemove.length === 0) return 0;

  await del(
    toRemove.map((img) => `images/${eventSlug}/${img.filename}`),
    { token },
  );

  index.images = index.images.filter((img) => img.discordMessageId !== discordMessageId);
  index.lastUpdated = new Date().toISOString();
  await writeEventIndex(eventSlug, index, token);

  return toRemove.length;
}
