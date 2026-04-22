import { log } from "evlog";

import { payload, wrapPayloadError } from "@/lib/ai/tools/cms/client";

import type { HackNightImage, UploadHackNightImageInput } from "./types";

const COLLECTION = "media";
const SOURCE = "hack-night";
const FETCH_TIMEOUT_MS = 15_000;
const LIST_PAGE_SIZE = 100;
const LIST_PAGE_CAP = 20;

interface PayloadMediaDoc {
  id?: number | string;
  filename?: string;
  url?: string;
  discordMessageId?: string;
  discordUserId?: string;
  createdAt?: string;
}

function projectImage(doc: PayloadMediaDoc): HackNightImage {
  return {
    id: doc.id ?? "",
    filename: doc.filename ?? "",
    url: doc.url ?? "",
    discordMessageId: doc.discordMessageId ?? "",
    discordUserId: doc.discordUserId ?? "",
    uploadedAt: doc.createdAt ?? "",
  };
}

function buildAltText(slug: string, filename: string): string {
  const date = slug.replace(/^hack-night-/, "");
  return `Hack Night ${date} photo — ${filename}`;
}

export async function uploadHackNightImage(
  input: UploadHackNightImageInput,
): Promise<HackNightImage> {
  try {
    let response: Response;
    try {
      response = await fetch(input.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (fetchErr) {
      if (fetchErr instanceof DOMException && fetchErr.name === "TimeoutError") {
        throw new Error(
          `Timed out fetching ${input.url} after ${FETCH_TIMEOUT_MS / 1000}s — host slow or unreachable.`,
        );
      }
      throw fetchErr;
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch ${input.url}: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const file = new File([blob], input.filename, {
      type: blob.type.length > 0 ? blob.type : input.contentType,
    });
    const doc = (await payload.create({
      collection: COLLECTION,
      data: {
        alt: buildAltText(input.slug, input.filename),
        source: SOURCE,
        batchId: input.slug,
        discordMessageId: input.discordMessageId,
        discordUserId: input.discordUserId,
      },
      file,
    })) as PayloadMediaDoc;
    return projectImage(doc);
  } catch (err) {
    throw wrapPayloadError(err);
  }
}

export async function hasHackNightImageForMessage(
  slug: string,
  discordMessageId: string,
): Promise<boolean> {
  try {
    const res = await payload.find({
      collection: COLLECTION,
      limit: 1,
      where: {
        source: { equals: SOURCE },
        batchId: { equals: slug },
        discordMessageId: { equals: discordMessageId },
      },
    });
    return res.totalDocs > 0;
  } catch (err) {
    throw wrapPayloadError(err);
  }
}

export async function listHackNightImages(slug: string): Promise<HackNightImage[]> {
  try {
    const images: HackNightImage[] = [];
    let page = 1;
    while (page <= LIST_PAGE_CAP) {
      const res = await payload.find({
        collection: COLLECTION,
        limit: LIST_PAGE_SIZE,
        page,
        sort: "createdAt",
        where: {
          source: { equals: SOURCE },
          batchId: { equals: slug },
        },
      });
      for (const doc of res.docs as PayloadMediaDoc[]) {
        images.push(projectImage(doc));
      }
      if (page >= res.totalPages) return images;
      page += 1;
    }
    log.warn(
      "hack-night",
      `listHackNightImages(${slug}) hit page cap ${LIST_PAGE_CAP}; truncating at ${images.length} images`,
    );
    return images;
  } catch (err) {
    throw wrapPayloadError(err);
  }
}

export async function deleteHackNightImagesForMessage(
  slug: string,
  discordMessageId: string,
): Promise<number> {
  let res;
  try {
    res = await payload.find({
      collection: COLLECTION,
      limit: LIST_PAGE_SIZE,
      where: {
        source: { equals: SOURCE },
        batchId: { equals: slug },
        discordMessageId: { equals: discordMessageId },
      },
    });
  } catch (err) {
    throw wrapPayloadError(err);
  }
  let removed = 0;
  for (const doc of res.docs as PayloadMediaDoc[]) {
    if (doc.id === undefined) continue;
    try {
      await payload.delete({ collection: COLLECTION, id: doc.id });
      removed += 1;
    } catch (err) {
      log.warn(
        "hack-night",
        `Failed to delete media ${String(doc.id)} for message ${discordMessageId}: ${String(err)}`,
      );
    }
  }
  return removed;
}
