import type { GetProjectFilesResponse, GetTeamProjectsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeFile } from "../../projections.ts";

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
