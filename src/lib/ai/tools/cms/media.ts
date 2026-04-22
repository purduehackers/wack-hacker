import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { cmsAdminUrl, paginationQuery, payload, wrapPayloadError } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const COLLECTION = "media";

interface PayloadMedia {
  id?: number | string;
  alt?: string;
  url?: string;
  thumbnailURL?: string;
  filename?: string;
  mimeType?: string;
  filesize?: number;
  width?: number;
  height?: number;
  batchId?: string;
  discordMessageId?: string;
  discordUserId?: string;
  source?: string;
  createdAt?: string;
  updatedAt?: string;
}

function projectMedia(m: PayloadMedia) {
  return {
    id: m.id,
    alt: m.alt,
    url: m.url,
    thumbnail_url: m.thumbnailURL,
    filename: m.filename,
    mime_type: m.mimeType,
    filesize: m.filesize,
    width: m.width,
    height: m.height,
    batch_id: m.batchId,
    discord_message_id: m.discordMessageId,
    discord_user_id: m.discordUserId,
    source: m.source,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
    href: m.id === undefined ? undefined : cmsAdminUrl(COLLECTION, m.id),
  };
}

export const list_media = tool({
  description:
    "List media assets uploaded to Payload CMS. Supports filtering by `source` ('manual' / 'hack-night') and `batch_id` (to group hack-night uploads).",
  inputSchema: z.object({
    ...paginationInputShape,
    source: z.string().optional(),
    batch_id: z.string().optional(),
  }),
  execute: async ({ source, batch_id, ...input }) => {
    try {
      const where = {
        ...(source !== undefined && { source: { equals: source } }),
        ...(batch_id !== undefined && { batchId: { equals: batch_id } }),
      };
      const res = await payload.find({
        collection: COLLECTION,
        ...paginationQuery(input),
        ...(Object.keys(where).length > 0 ? { where } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: (res.docs as PayloadMedia[]).map(projectMedia),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const get_media = tool({
  description: "Fetch a single media asset by ID.",
  inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
  execute: async ({ id }) => {
    try {
      const doc = (await payload.findByID({ collection: COLLECTION, id })) as PayloadMedia;
      return JSON.stringify(projectMedia(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const upload_media = tool({
  description:
    "Upload an image from a public URL to the CMS media library. Fetches the URL, then posts to Payload's media collection with the given alt text. Returns the created media record (including its new `id` and `url`).",
  inputSchema: z.object({
    url: z.string().url().describe("Publicly reachable URL to fetch the image from"),
    alt: z.string(),
    filename: z.string().optional(),
    source: z
      .enum(["manual", "hack-night"])
      .optional()
      .describe("Upload source tag (default: manual)"),
    batch_id: z.string().optional(),
    discord_message_id: z.string().optional(),
    discord_user_id: z.string().optional(),
  }),
  execute: async ({
    url,
    alt,
    filename,
    source,
    batch_id,
    discord_message_id,
    discord_user_id,
  }) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const resolvedFilename = filename ?? deriveFilenameFromUrl(url);
      const file = new File([blob], resolvedFilename, { type: blob.type });
      const data: Record<string, unknown> = { alt };
      if (source !== undefined) data.source = source;
      if (batch_id !== undefined) data.batchId = batch_id;
      if (discord_message_id !== undefined) data.discordMessageId = discord_message_id;
      if (discord_user_id !== undefined) data.discordUserId = discord_user_id;
      const doc = (await payload.create({
        collection: COLLECTION,
        data,
        file,
      })) as PayloadMedia;
      return JSON.stringify(projectMedia(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

export const delete_media = approval(
  tool({
    description:
      "Delete a media asset permanently. Referenced pages/posts will lose their image until relinked.",
    inputSchema: z.object({ id: z.union([z.string(), z.number()]) }),
    execute: async ({ id }) => {
      try {
        const doc = (await payload.delete({ collection: COLLECTION, id })) as PayloadMedia;
        return JSON.stringify({ deleted: true, id: doc.id ?? id });
      } catch (err) {
        throw wrapPayloadError(err);
      }
    },
  }),
);

function deriveFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").at(-1) ?? "";
    return last.length > 0 ? decodeURIComponent(last) : "upload";
  } catch {
    return "upload";
  }
}
