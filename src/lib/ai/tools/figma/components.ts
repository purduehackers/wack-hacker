import { tool } from "ai";
import { z } from "zod";

import { figma } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeComponent(c: any) {
  return {
    key: c.key,
    name: c.name,
    description: c.description,
    fileKey: c.file_key,
    nodeId: c.node_id,
    thumbnailUrl: c.thumbnail_url,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

function summarizeStyle(s: any) {
  return {
    key: s.key,
    name: s.name,
    description: s.description,
    styleType: s.style_type,
    fileKey: s.file_key,
    nodeId: s.node_id,
    thumbnailUrl: s.thumbnail_url,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Component tools
// ---------------------------------------------------------------------------

export const list_team_components = tool({
  description: "List published components across the team. Paginated.",
  inputSchema: z.object({
    page_size: z.number().max(100).optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor from a previous response"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const qs = params.toString();

    const data = (await figma.get(
      `/v1/teams/${figma.teamId}/components${qs ? `?${qs}` : ""}`,
    )) as any;
    return JSON.stringify({
      components: data.meta?.components?.map(summarizeComponent) ?? [],
      cursor: data.meta?.cursor,
    });
  },
});

export const list_file_components = tool({
  description: "List components in a specific Figma file.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = (await figma.get(`/v1/files/${file_key}/components`)) as any;
    return JSON.stringify({
      components: data.meta?.components?.map(summarizeComponent) ?? [],
    });
  },
});

export const get_component = tool({
  description: "Get full details of a published component by its key.",
  inputSchema: z.object({
    component_key: z.string().describe("The component key"),
  }),
  execute: async ({ component_key }) => {
    const data = (await figma.get(`/v1/components/${component_key}`)) as any;
    return JSON.stringify(summarizeComponent(data.meta));
  },
});

export const list_team_component_sets = tool({
  description:
    "List published component sets (variant groups) across the team. A component set groups variants of the same component.",
  inputSchema: z.object({
    page_size: z.number().max(100).optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const qs = params.toString();

    const data = (await figma.get(
      `/v1/teams/${figma.teamId}/component_sets${qs ? `?${qs}` : ""}`,
    )) as any;
    return JSON.stringify({
      componentSets: data.meta?.component_sets?.map(summarizeComponent) ?? [],
      cursor: data.meta?.cursor,
    });
  },
});

export const get_component_set = tool({
  description: "Get full details of a published component set by its key.",
  inputSchema: z.object({
    component_set_key: z.string().describe("The component set key"),
  }),
  execute: async ({ component_set_key }) => {
    const data = (await figma.get(`/v1/component_sets/${component_set_key}`)) as any;
    return JSON.stringify(summarizeComponent(data.meta));
  },
});

// ---------------------------------------------------------------------------
// Style tools
// ---------------------------------------------------------------------------

export const list_team_styles = tool({
  description: "List published styles (colors, text, effects, grids) across the team. Paginated.",
  inputSchema: z.object({
    page_size: z.number().max(100).optional().describe("Results per page (max 100)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ page_size, cursor }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (cursor) params.set("after", cursor);
    const qs = params.toString();

    const data = (await figma.get(`/v1/teams/${figma.teamId}/styles${qs ? `?${qs}` : ""}`)) as any;
    return JSON.stringify({
      styles: data.meta?.styles?.map(summarizeStyle) ?? [],
      cursor: data.meta?.cursor,
    });
  },
});

export const list_file_styles = tool({
  description: "List styles in a specific Figma file.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
  }),
  execute: async ({ file_key }) => {
    const data = (await figma.get(`/v1/files/${file_key}/styles`)) as any;
    return JSON.stringify({
      styles: data.meta?.styles?.map(summarizeStyle) ?? [],
    });
  },
});

export const get_style = tool({
  description: "Get full details of a published style by its key.",
  inputSchema: z.object({
    style_key: z.string().describe("The style key"),
  }),
  execute: async ({ style_key }) => {
    const data = (await figma.get(`/v1/styles/${style_key}`)) as any;
    return JSON.stringify(summarizeStyle(data.meta));
  },
});
