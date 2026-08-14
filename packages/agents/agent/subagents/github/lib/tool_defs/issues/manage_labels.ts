import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const manage_labels = defineTool({
  description: `Create, update, or delete a label in a repository. For 'create' and 'update', you can set name, color (hex without #), and description. For 'update', use new_name to rename. Returns the label name and color on success.`,
  access: { risk: "destructive" },
  input: z.strictObject({
    repo: repoField,
    action: z.enum(["create", "update", "delete"]),
    name: z.string().describe("Label name"),
    new_name: z.string().exactOptional().describe("New name (for update)"),
    color: z
      .stringFormat("github-label-color", /^[0-9A-Fa-f]{6}$/u)
      .exactOptional()
      .describe("Hex color without # (e.g. 'ff0000')"),
    description: z.string().exactOptional(),
  }),
  execute: async ({ repo, action, name, new_name, ...fields }) => {
    switch (action) {
      case "create": {
        const { data } = await octokit().rest.issues.createLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
          ...fields,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "update": {
        const { data } = await octokit().rest.issues.updateLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
          ...(new_name !== undefined && { new_name }),
          ...fields,
        });
        return JSON.stringify({ name: data.name, color: data.color });
      }
      case "delete":
        await octokit().rest.issues.deleteLabel({
          owner: env.GITHUB_ORG,
          repo,
          name,
        });
        return JSON.stringify({ deleted: true, name });
    }
  },
});
