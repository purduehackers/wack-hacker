import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, perPageField, repoField } from "../../constants.ts";

export const list_collaborators = defineTool({
  description:
    "List collaborators with direct access to a repository. Returns login, permissions, and role.",
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    affiliation: z.enum(["outside", "direct", "all"]).optional(),
    per_page: perPageField,
  }),
  execute: async ({ repo, affiliation, per_page }) => {
    const { data } = await octokit().rest.repos.listCollaborators({
      owner: env.GITHUB_ORG,
      repo,
      affiliation: affiliation ?? "all",
      per_page: per_page ?? 30,
    });
    return JSON.stringify(
      data.map((c) => ({
        login: c.login,
        permissions: c.permissions,
        role_name: c.role_name,
      })),
    );
  },
});
