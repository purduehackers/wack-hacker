import type { GetFileVersionsResponse } from "@figma/rest-api-spec";

import { tool } from "ai";
import { z } from "zod";

import { figma } from "./client.ts";

export const list_versions = tool({
  description:
    "List version history of a Figma file. Returns version IDs, labels, descriptions, timestamps, and the user who created each version.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key"),
    page_size: z.number().max(100).optional().describe("Number of versions to return (max 100)"),
    before: z.string().optional().describe("Version ID to paginate before"),
    after: z.string().optional().describe("Version ID to paginate after"),
  }),
  execute: async ({ file_key, page_size, before, after }) => {
    const params = new URLSearchParams();
    if (page_size) params.set("page_size", String(page_size));
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    const qs = params.toString();

    const data = await figma.get<GetFileVersionsResponse>(
      `/v1/files/${file_key}/versions${qs ? `?${qs}` : ""}`,
    );
    return JSON.stringify({
      versions: data.versions.map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        createdAt: v.created_at,
        user: v.user.handle,
      })),
      pagination: data.pagination,
    });
  },
});
