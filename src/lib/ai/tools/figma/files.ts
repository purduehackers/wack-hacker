import { tool } from "ai";
import { z } from "zod";

import { figmaFetch, figmaFileUrl } from "./client.ts";

export const get_file_nodes = tool({
  description: `Get specific nodes (frames, components, groups) from a Figma file by their IDs. Returns node properties including name, type, bounding box, and children. Use get_file_metadata first to discover page/frame IDs.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
    node_ids: z.array(z.string()).describe('Node IDs to fetch (format: "X:Y")'),
    depth: z.number().optional().describe("How deep to traverse children (omit for full depth)"),
  }),
  execute: async ({ file_key, node_ids, depth }) => {
    const ids = node_ids.join(",");
    const depthParam = depth !== undefined ? `&depth=${depth}` : "";
    const data = await figmaFetch<{
      nodes: Record<string, { document: unknown } | null>;
    }>(`/files/${file_key}/nodes?ids=${encodeURIComponent(ids)}${depthParam}`);
    return JSON.stringify({
      nodes: Object.entries(data.nodes).map(([id, node]) => ({
        id,
        url: figmaFileUrl(file_key, id),
        ...(node ? { document: node.document } : { error: "Node not found" }),
      })),
    });
  },
});

export const export_file_images = tool({
  description: `Export/render Figma nodes as images. Returns temporary URLs for PNG, SVG, JPG, or PDF. Use this to share design screenshots in Discord. URLs expire after 14 days.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
    node_ids: z.array(z.string()).describe("Node IDs to export"),
    format: z.enum(["png", "svg", "jpg", "pdf"]).default("png").describe("Image format"),
    scale: z
      .number()
      .min(0.01)
      .max(4)
      .optional()
      .describe("Scale factor (0.01–4, default 1). Only applies to png/jpg."),
  }),
  execute: async ({ file_key, node_ids, format, scale }) => {
    const ids = node_ids.join(",");
    const scaleParam = scale !== undefined ? `&scale=${scale}` : "";
    const data = await figmaFetch<{
      images: Record<string, string | null>;
    }>(`/images/${file_key}?ids=${encodeURIComponent(ids)}&format=${format}${scaleParam}`);
    return JSON.stringify({
      images: Object.entries(data.images).map(([id, url]) => ({
        node_id: id,
        url: url ?? null,
        figma_url: figmaFileUrl(file_key, id),
      })),
    });
  },
});

export const list_file_versions = tool({
  description: `List version history of a Figma file. Returns version ID, label, description, creator, and timestamp. Useful for "what changed recently?" queries.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
    page_size: z.number().max(100).optional().describe("Number of versions to return"),
  }),
  execute: async ({ file_key, page_size }) => {
    const pageSizeParam = page_size ? `?page_size=${page_size}` : "";
    const data = await figmaFetch<{
      versions: Array<{
        id: string;
        label: string;
        description: string;
        created_at: string;
        user: { handle: string; id: string };
      }>;
    }>(`/files/${file_key}/versions${pageSizeParam}`);
    return JSON.stringify({
      versions: data.versions.map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        created_at: v.created_at,
        created_by: v.user.handle,
      })),
    });
  },
});
