import { tool } from "ai";
import { z } from "zod";

import { figma, figmaFileUrl } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeFile(f: any, projectName?: string) {
  return {
    key: f.key,
    name: f.name,
    lastModified: f.last_modified,
    thumbnailUrl: f.thumbnail_url,
    url: figmaFileUrl(f.key),
    ...(projectName ? { projectName } : {}),
  };
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export const get_file = tool({
  description:
    "Get a Figma file's metadata and document structure. Use depth to control how deep the node tree goes (default 1 = pages only). Large files can be enormous — start shallow.",
  inputSchema: z.object({
    file_key: z.string().describe("The file key (from the Figma URL)"),
    depth: z
      .number()
      .min(1)
      .max(4)
      .default(1)
      .describe("How deep to traverse the node tree (1 = pages only, max 4)"),
  }),
  execute: async ({ file_key, depth }) => {
    const file = (await figma.get(`/v1/files/${file_key}?depth=${depth}`)) as any;
    return JSON.stringify({
      name: file.name,
      lastModified: file.lastModified,
      version: file.version,
      url: figmaFileUrl(file_key),
      document: file.document,
      editorType: file.editorType,
    });
  },
});

export const list_projects = tool({
  description: "List all projects in the team. Returns project IDs and names.",
  inputSchema: z.object({}),
  execute: async () => {
    const data = (await figma.get(`/v1/teams/${figma.teamId}/projects`)) as any;
    return JSON.stringify(
      data.projects.map((p: any) => ({
        id: p.id,
        name: p.name,
      })),
    );
  },
});

export const list_project_files = tool({
  description:
    "List files in a specific project. Returns file keys, names, last modified times, and thumbnail URLs.",
  inputSchema: z.object({
    project_id: z.string().describe("The project ID"),
  }),
  execute: async ({ project_id }) => {
    const data = (await figma.get(`/v1/projects/${project_id}/files`)) as any;
    return JSON.stringify(data.files.map((f: any) => summarizeFile(f)));
  },
});

export const search_files = tool({
  description:
    "Search for files by name across all team projects. Fetches all projects and their files, then filters by query. May be slow for large teams.",
  inputSchema: z.object({
    query: z.string().describe("Search query to match against file names (case-insensitive)"),
    limit: z.number().max(50).default(10).describe("Max results to return"),
  }),
  execute: async ({ query, limit }) => {
    const data = (await figma.get(`/v1/teams/${figma.teamId}/projects`)) as any;
    const lowerQuery = query.toLowerCase();
    const matches: any[] = [];

    for (const proj of data.projects) {
      if (matches.length >= limit) break;
      const files = (await figma.get(`/v1/projects/${proj.id}/files`)) as any;
      for (const f of files.files) {
        if (matches.length >= limit) break;
        if (f.name.toLowerCase().includes(lowerQuery)) {
          matches.push(summarizeFile(f, proj.name));
        }
      }
    }

    return JSON.stringify(matches);
  },
});
