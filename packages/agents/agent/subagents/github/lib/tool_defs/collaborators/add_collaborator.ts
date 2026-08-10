import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const add_collaborator = defineTool({
  description:
    "Add a user as a direct collaborator on a repository. Permission defaults to 'push' (write). Options: pull, triage, push, maintain, admin.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    repo: repoField,
    username: z.string().min(1).describe("GitHub username"),
    permission: z
      .enum(["pull", "triage", "push", "maintain", "admin"])
      .optional()
      .describe("Permission level (default push)"),
  }),
  execute: async ({ repo, username, permission }) => {
    const { data } = await octokit().rest.repos.addCollaborator({
      owner: env.GITHUB_ORG,
      repo,
      username,
      permission: permission ?? "push",
    });
    return JSON.stringify({
      user: username,
      permission: permission ?? "push",
      invitation_id: data?.id,
    });
  },
});
