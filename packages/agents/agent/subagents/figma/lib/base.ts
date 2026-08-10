import type {
  GetFileResponse,
  GetProjectFilesResponse,
  GetTeamProjectsResponse,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { figma, figmaFileUrl } from "./client.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summarizeFile(f: GetProjectFilesResponse["files"][number], projectName?: string) {
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

export const get_file = defineTool({
  description:
    "Get a Figma file's metadata and document structure. Use depth to control how deep the node tree goes (default 1 = pages only). Large files can be enormous — start shallow.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: z.string().describe("The file key (from the Figma URL)"),
    depth: z
      .int()
      .min(1)
      .max(4)
      .default(1)
      .describe("How deep to traverse the node tree (1 = pages only, max 4)"),
  }),
  execute: async ({ file_key, depth }) => {
    const file = await figma.get<GetFileResponse>(`/v1/files/${file_key}?depth=${depth}`);
    return {
      name: file.name,
      lastModified: file.lastModified,
      version: file.version,
      url: figmaFileUrl(file_key),
      document: file.document,
      editorType: file.editorType,
    };
  },
});

export const list_projects = defineTool({
  description: "List all projects in the team. Returns project IDs and names.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const data = await figma.get<GetTeamProjectsResponse>(`/v1/teams/${figma.teamId}/projects`);
    return data.projects.map((p) => ({
      id: p.id,
      name: p.name,
    }));
  },
});

export const list_project_files = defineTool({
  description:
    "List files in a specific project. Returns file keys, names, last modified times, and thumbnail URLs.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id: z.string().describe("The project ID"),
  }),
  execute: async ({ project_id }) => {
    const data = await figma.get<GetProjectFilesResponse>(`/v1/projects/${project_id}/files`);
    return data.files.map((f) => summarizeFile(f));
  },
});

export const search_files = defineTool({
  description:
    "Search for files by name across all team projects. Fetches all projects and their files, then filters by query. May be slow for large teams.",
  access: { risk: "read" },
  input: z.strictObject({
    query: z.string().describe("Search query to match against file names (case-insensitive)"),
    limit: z.int().min(1).max(50).default(10).describe("Max results to return"),
  }),
  execute: async ({ query, limit }) => {
    const data = await figma.get<GetTeamProjectsResponse>(`/v1/teams/${figma.teamId}/projects`);
    const lowerQuery = query.toLowerCase();
    const matches: ReturnType<typeof summarizeFile>[] = [];

    const CONCURRENCY = 5;
    for (let i = 0; i < data.projects.length && matches.length < limit; i += CONCURRENCY) {
      const batch = data.projects.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((p) =>
          figma
            .get<GetProjectFilesResponse>(`/v1/projects/${p.id}/files`)
            .then((r) => ({ projectName: p.name, files: r.files })),
        ),
      );
      for (const { projectName, files } of results) {
        for (const f of files) {
          if (matches.length >= limit) break;
          if (f.name.toLowerCase().includes(lowerQuery)) {
            matches.push(summarizeFile(f, projectName));
          }
        }
      }
    }

    return matches;
  },
});
