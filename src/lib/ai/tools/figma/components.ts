import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { figmaFetch, figmaFileUrl } from "./client.ts";

export const list_file_components = tool({
  description: `List all components defined in a Figma file. Returns component name, key, description, and containing frame.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figmaFetch<{
      meta: {
        components: Array<{
          key: string;
          name: string;
          description: string;
          node_id: string;
          containing_frame: { name: string; nodeId: string } | null;
        }>;
      };
    }>(`/files/${file_key}/components`);
    return JSON.stringify({
      file_url: figmaFileUrl(file_key),
      components: data.meta.components.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        node_id: c.node_id,
        containing_frame: c.containing_frame?.name ?? null,
      })),
    });
  },
});

export const list_team_components = tool({
  description: `List all published components in the Purdue Hackers team library. These are shared components available across all team files.`,
  inputSchema: z.object({
    page_size: z.number().max(100).optional().describe("Results per page"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const query = params.toString();

    const data = await figmaFetch<{
      meta: {
        components: Array<{
          key: string;
          name: string;
          description: string;
          file_key: string;
          node_id: string;
          thumbnail_url: string;
        }>;
        cursor: Record<string, number>;
      };
    }>(`/teams/${env.FIGMA_TEAM_ID}/components${query ? `?${query}` : ""}`);
    return JSON.stringify({
      components: data.meta.components.map((c) => ({
        key: c.key,
        name: c.name,
        description: c.description,
        file_url: figmaFileUrl(c.file_key, c.node_id),
        thumbnail_url: c.thumbnail_url,
      })),
      cursor: data.meta.cursor,
    });
  },
});

export const list_file_styles = tool({
  description: `List all styles (colors, text, effects, grids) defined in a Figma file.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key"),
  }),
  execute: async ({ file_key }) => {
    const data = await figmaFetch<{
      meta: {
        styles: Array<{
          key: string;
          name: string;
          description: string;
          style_type: string;
          node_id: string;
        }>;
      };
    }>(`/files/${file_key}/styles`);
    return JSON.stringify({
      file_url: figmaFileUrl(file_key),
      styles: data.meta.styles.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        type: s.style_type,
        node_id: s.node_id,
      })),
    });
  },
});

export const list_team_styles = tool({
  description: `List all published styles in the Purdue Hackers team library. Includes colors, typography, effects, and grid styles shared across files.`,
  inputSchema: z.object({
    page_size: z.number().max(100).optional().describe("Results per page"),
    cursor: z.string().optional().describe("Pagination cursor from previous response"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const query = params.toString();

    const data = await figmaFetch<{
      meta: {
        styles: Array<{
          key: string;
          name: string;
          description: string;
          style_type: string;
          file_key: string;
          node_id: string;
          thumbnail_url: string;
        }>;
        cursor: Record<string, number>;
      };
    }>(`/teams/${env.FIGMA_TEAM_ID}/styles${query ? `?${query}` : ""}`);
    return JSON.stringify({
      styles: data.meta.styles.map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
        type: s.style_type,
        file_url: figmaFileUrl(s.file_key, s.node_id),
        thumbnail_url: s.thumbnail_url,
      })),
      cursor: data.meta.cursor,
    });
  },
});
