import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import {
  Routes,
  type RESTPostAPIGuildStickerFormDataBody,
  type RESTPostAPIGuildStickerResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { httpUrl } from "../../constants.ts";
import { download, summarizeSticker } from "../../projections.ts";

/** Discord infers a sticker's format from the upload's filename, not its bytes. */
function stickerFilename(contentType: string): string {
  switch (contentType) {
    case "application/json":
      return "sticker.json";
    case "image/gif":
      return "sticker.gif";
    case "image/apng":
    case "image/png":
      return "sticker.png";
    default:
      throw new UpstreamError({
        service: "image-source",
        status: 415,
        detail: `unsupported sticker content type ${contentType}`,
      });
  }
}

export const create_sticker = defineTool({
  access: { risk: "write" },
  description:
    "Upload a new custom sticker. Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended. Requires a name (2-30 chars), tag (autocomplete suggestion, 2-200 chars), and image URL.",
  input: z.strictObject({
    name: z.string().trim().min(2).max(30),
    description: z.union([z.literal(""), z.string().trim().min(2).max(100)]).default(""),
    tags: z.string().trim().min(2).max(200),
    url: httpUrl,
  }),
  execute: async (input) => {
    const rest = discordRest();
    const file = await download(input.url, 512 * 1_024, [
      "image/png",
      "image/apng",
      "image/gif",
      "application/json",
    ]);
    const sticker = discordObject<RESTPostAPIGuildStickerResult>(
      await rest.post(Routes.guildStickers(DISCORD_GUILD_ID), {
        body: compact<Omit<RESTPostAPIGuildStickerFormDataBody, "file">>({
          name: input.name,
          description: input.description,
          tags: input.tags,
        }),
        files: [
          {
            data: file.bytes,
            name: stickerFilename(file.contentType),
            contentType: file.contentType,
          },
        ],
      }),
      "create guild sticker",
    );
    return summarizeSticker(sticker);
  },
});
