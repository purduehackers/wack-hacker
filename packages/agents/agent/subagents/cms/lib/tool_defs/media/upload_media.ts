import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { projectMedia } from "../../constants.ts";

const UPLOAD_FETCH_TIMEOUT_MS = 15_000;

export const upload_media = defineTool({
  description:
    "Upload an image from a public URL to the CMS media library. Fetches the URL, then posts to Payload's media collection with the given alt text. Returns the created media record (including its new `id` and `url`).",
  access: { risk: "write" },
  input: z.strictObject({
    url: z
      .url({ protocol: /^https?$/u })
      .describe("Publicly reachable http(s) URL to fetch the image from"),
    alt: z.string(),
    filename: z.string().optional(),
    source: z
      .enum(["manual", "hack-night", "discord-drop"])
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
      let response: Response;
      try {
        response = await fetch(url, {
          signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS),
        });
      } catch (fetchErr) {
        if (fetchErr instanceof DOMException && fetchErr.name === "TimeoutError") {
          throw new Error(
            `Timed out fetching ${url} after ${UPLOAD_FETCH_TIMEOUT_MS / 1000}s — host slow or unreachable.`,
          );
        }
        throw fetchErr;
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      const resolvedFilename = filename ?? deriveFilenameFromUrl(url);
      const file = new File([blob], resolvedFilename, { type: blob.type });
      const data = {
        alt,
        ...(source !== undefined && { source }),
        ...(batch_id !== undefined && { batchId: batch_id }),
        ...(discord_message_id !== undefined && { discordMessageId: discord_message_id }),
        ...(discord_user_id !== undefined && { discordUserId: discord_user_id }),
      };
      const doc = await payload.create({
        collection: "media",
        data,
        file,
      });
      return JSON.stringify(projectMedia(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});

function deriveFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").at(-1) ?? "";
    return last.length > 0 ? decodeURIComponent(last) : "upload";
  } catch {
    return "upload";
  }
}
