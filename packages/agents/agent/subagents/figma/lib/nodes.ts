import type {
  GetFileNodesResponse,
  GetImageFillsResponse,
  GetImagesResponse,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { figma } from "./client.ts";

export const get_file_nodes = defineTool({
  description:
    "Get specific nodes from a Figma file by their IDs. Returns the full node subtree with properties. Use get_file first to discover node IDs.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: z.string().describe("The file key"),
    node_ids: z.array(z.string()).min(1).describe('Node IDs to retrieve (e.g., ["1:2", "3:456"])'),
    depth: z.int().min(1).max(4).optional().describe("How deep to traverse each node subtree"),
  }),
  execute: async ({ file_key, node_ids, depth }) => {
    const params = new URLSearchParams({ ids: node_ids.join(",") });
    if (depth) params.set("depth", String(depth));
    const data = await figma.get<GetFileNodesResponse>(
      `/v1/files/${file_key}/nodes?${params.toString()}`,
    );
    return data.nodes;
  },
});

export const get_images = defineTool({
  description:
    "Export nodes from a Figma file as images. Returns temporary download URLs (valid ~14 days). Supported formats: png, svg, jpg, pdf.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: z.string().describe("The file key"),
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

export const get_image_fills = defineTool({
  description:
    "Get download URLs for all images used as fills in a Figma file (photos, textures, etc.).",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetImageFillsResponse>(`/v1/files/${file_key}/images`);
    return data.meta.images;
  },
});
