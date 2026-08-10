import type { GetImagesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_images = defineTool({
  description:
    "Export nodes from a Figma file as images. Returns temporary download URLs (valid ~14 days). Supported formats: png, svg, jpg, pdf.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
    node_ids: z.array(z.string()).min(1).describe("Node IDs to export"),
    format: z.enum(["png", "svg", "jpg", "pdf"]).default("png").describe("Image format"),
    scale: z
      .number()
      .min(0.01)
      .max(4)
      .default(1)
      .describe("Scale factor for raster formats (0.01–4)"),
  }),
  execute: async ({ file_key, node_ids, format, scale }) => {
    const params = new URLSearchParams({
      ids: node_ids.join(","),
      format,
      scale: String(scale),
    });
    const data = await figma.get<GetImagesResponse>(`/v1/images/${file_key}?${params.toString()}`);
    return data.images;
  },
});
