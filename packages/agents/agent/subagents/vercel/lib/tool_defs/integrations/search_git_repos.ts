import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const search_git_repos = defineTool({
  description:
    "Search Git repos available to the team across installed Git integrations — use when creating a new project from a repo.",
  access: { risk: "read" },
  input: z.strictObject({
    host: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    provider: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    namespaceId: z.string().optional(),
    query: z.string().optional(),
    installationId: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.searchRepo({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
