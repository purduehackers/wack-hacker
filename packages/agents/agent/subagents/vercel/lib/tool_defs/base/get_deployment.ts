import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_deployment = defineTool({
  description:
    "Retrieve a deployment by its id (dpl_…) or URL hostname. Returns full metadata, build info, creator, alias assignment, commit details.",
  access: { risk: "read" },
  input: z.strictObject({
    id_or_url: z.string().describe("Deployment id (dpl_…) or hostname (my-app-abc123.vercel.app)"),
    withGitRepoInfo: z.enum(["true", "false"]).optional(),
  }),
  execute: async ({ id_or_url, withGitRepoInfo }) => {
    const result = await vercel().deployments.getDeployment({
      ...TEAM,
      idOrUrl: id_or_url,
      withGitRepoInfo,
    });
    return JSON.stringify(result);
  },
});
