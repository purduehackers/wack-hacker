import type { GetProjectFilesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeFile } from "../../constants.ts";

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
