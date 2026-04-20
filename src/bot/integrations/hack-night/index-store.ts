import { BlobNotFoundError, BlobPreconditionFailedError, del, head, put } from "@vercel/blob";
import { log } from "evlog";

import type { EventIndex, ImageMetadata } from "./types";

// Read-modify-write attempts on the index JSON. Conflicts surface as
// `BlobPreconditionFailedError` for both an ETag mismatch on update and an
// `allowOverwrite: false` race on first create.
const MAX_MODIFY_ATTEMPTS = 5;

function indexKey(eventSlug: string): string {
  return `images/${eventSlug}/index.json`;
}

type CurrentIndex = { index: EventIndex; etag: string } | null;

async function readCurrentIndex(eventSlug: string, token: string): Promise<CurrentIndex> {
  try {
    const meta = await head(indexKey(eventSlug), { token });
    const res = await fetch(meta.url);
    if (!res.ok) throw new Error(`event index fetch failed: ${res.status}`);
    const index = (await res.json()) as EventIndex;
    return { index, etag: meta.etag };
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

export async function getEventIndex(eventSlug: string, token: string): Promise<EventIndex | null> {
  const current = await readCurrentIndex(eventSlug, token);
  return current?.index ?? null;
}

async function modifyEventIndex(
  eventSlug: string,
  token: string,
  mutate: (index: EventIndex) => void,
): Promise<EventIndex> {
  for (let attempt = 0; attempt < MAX_MODIFY_ATTEMPTS; attempt++) {
    const current = await readCurrentIndex(eventSlug, token);
    const index = current?.index ?? {
      eventSlug,
      lastUpdated: new Date().toISOString(),
      images: [],
    };
    mutate(index);
    index.lastUpdated = new Date().toISOString();
    const body = JSON.stringify(index, null, 2);

    try {
      await put(indexKey(eventSlug), body, {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json",
        token,
        ...(current ? { allowOverwrite: true, ifMatch: current.etag } : { allowOverwrite: false }),
      });
      return index;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError && attempt < MAX_MODIFY_ATTEMPTS - 1) {
        continue;
      }
      throw err;
    }
  }
  throw new Error(`event index update exhausted retries for ${eventSlug}`);
}

export async function updateEventIndex(
  eventSlug: string,
  images: ImageMetadata[],
  token: string,
): Promise<void> {
  if (images.length === 0) return;
  const next = await modifyEventIndex(eventSlug, token, (index) => {
    index.images.push(...images);
  });
  log.info(
    "hack-night",
    `Updated index for ${eventSlug}: ${next.images.length} images total (+${images.length})`,
  );
}

export async function removeImagesForMessage(
  eventSlug: string,
  discordMessageId: string,
  token: string,
): Promise<number> {
  const initial = await getEventIndex(eventSlug, token);
  if (!initial) return 0;
  if (!initial.images.some((img) => img.discordMessageId === discordMessageId)) return 0;

  let removed: ImageMetadata[] = [];
  await modifyEventIndex(eventSlug, token, (index) => {
    removed = index.images.filter((img) => img.discordMessageId === discordMessageId);
    index.images = index.images.filter((img) => img.discordMessageId !== discordMessageId);
  });

  if (removed.length === 0) return 0;

  await del(
    removed.map((img) => `images/${eventSlug}/${img.filename}`),
    { token },
  );
  return removed.length;
}
