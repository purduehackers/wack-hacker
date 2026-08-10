import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const create_issue = defineTool({
  description: `Create a new issue in a repository. Supports Markdown body, assignees, labels, and milestone. Returns the issue number, title, URL, and state.`,
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    title: z.string().describe("Issue title"),
    body: z.string().exactOptional().describe("Issue body (Markdown)"),
    assignees: z.array(z.string()).exactOptional().describe("GitHub usernames to assign"),
    labels: z.array(z.string()).exactOptional().describe("Label names to apply"),
    milestone: resourceId.exactOptional().describe("Milestone number"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.issues.create({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      number: data.number,
      title: data.title,
      html_url: data.html_url,
      state: data.state,
    });
  },
});
