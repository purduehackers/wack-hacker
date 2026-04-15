import { tool } from "ai";
import { z } from "zod";

import { env } from "../../../../env.ts";
import { figmaFetch, figmaFileUrl } from "./client.ts";

export const list_team_projects = tool({
  description: `List all projects in the Purdue Hackers Figma team. Returns project names and IDs — use a project ID with list_project_files to browse its contents.`,
  inputSchema: z.object({}),
  execute: async () => {
    const data = await figmaFetch<{
      projects: Array<{ id: string; name: string }>;
    }>(`/teams/${env.FIGMA_TEAM_ID}/projects`);
    return JSON.stringify({ projects: data.projects });
  },
});

export const list_project_files = tool({
  description: `List files in a Figma project. Returns file name, key (ID), thumbnail URL, and last modified time.`,
  inputSchema: z.object({
    project_id: z.string().describe("Project ID from list_team_projects"),
  }),
  execute: async ({ project_id }) => {
    const data = await figmaFetch<{
      files: Array<{
        key: string;
        name: string;
        thumbnail_url: string;
        last_modified: string;
      }>;
    }>(`/projects/${project_id}/files`);
    return JSON.stringify({
      files: data.files.map((f) => ({
        key: f.key,
        name: f.name,
        url: figmaFileUrl(f.key),
        thumbnail_url: f.thumbnail_url,
        last_modified: f.last_modified,
      })),
    });
  },
});

export const get_file_metadata = tool({
  description: `Get a Figma file's metadata — name, last modified, version, and top-level pages/frames. A shallow fetch that does not download the full node tree.`,
  inputSchema: z.object({
    file_key: z.string().describe("Figma file key (from URL or list_project_files)"),
  }),
  execute: async ({ file_key }) => {
    const data = await figmaFetch<{
      name: string;
      lastModified: string;
      version: string;
      document: { children: Array<{ id: string; name: string; type: string }> };
    }>(`/files/${file_key}?depth=1`);
    return JSON.stringify({
      name: data.name,
      url: figmaFileUrl(file_key),
      last_modified: data.lastModified,
      version: data.version,
      pages: data.document.children.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
      })),
    });
  },
});

export const get_current_user = tool({
  description: `Get the Figma user the bot is authenticated as. Returns user ID, handle, and email.`,
  inputSchema: z.object({}),
  execute: async () => {
    const data = await figmaFetch<{
      id: string;
      handle: string;
      email: string;
      img_url: string;
    }>("/me");
    return JSON.stringify({
      id: data.id,
      handle: data.handle,
      email: data.email,
    });
  },
});
