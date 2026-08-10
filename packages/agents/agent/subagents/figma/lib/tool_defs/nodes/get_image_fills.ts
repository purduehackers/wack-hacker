import type { GetImageFillsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_image_fills = defineTool({
  description:
    "Get download URLs for all images used as fills in a Figma file (photos, textures, etc.).",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetImageFillsResponse>(`/v1/files/${file_key}/images`);
    return data.meta.images;
  },
});
