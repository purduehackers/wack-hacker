import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const list_git_namespaces = defineTool({
  description:
    "List Git namespaces (orgs/users) accessible to the team across GitHub/GitLab/Bitbucket integrations.",
  access: { risk: "read" },
  input: z.strictObject({
    host: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    provider: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.gitNamespaces({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
