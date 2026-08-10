import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField } from "../../constants.ts";

export const create_release = defineTool({
  description:
    "Create a new release for a repository. Requires tag_name; will auto-create the tag if it doesn't exist. Supports draft releases and prereleases.",
  access: { risk: "write" },
  input: z.strictObject({
    repo: repoField,
    tag_name: z.string().min(1).describe("Tag name (created if new)"),
    target_commitish: z.string().exactOptional().describe("Branch or commit SHA the tag points to"),
    name: z.string().exactOptional().describe("Release title"),
    body: z.string().exactOptional().describe("Release notes (Markdown)"),
    draft: z.boolean().exactOptional(),
    prerelease: z.boolean().exactOptional(),
    generate_release_notes: z
      .boolean()
      .exactOptional()
      .describe("Auto-generate notes from PRs since the last release"),
  }),
  execute: async ({ repo, ...fields }) => {
    const { data } = await octokit().rest.repos.createRelease({
      owner: env.GITHUB_ORG,
      repo,
      ...fields,
    });
    return JSON.stringify({
      id: data.id,
      tag_name: data.tag_name,
      name: data.name,
      html_url: data.html_url,
    });
  },
});
