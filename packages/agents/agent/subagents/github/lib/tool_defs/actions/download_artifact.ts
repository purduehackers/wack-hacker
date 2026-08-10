import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { octokit } from "../../client.ts";
import { env, repoField, resourceId } from "../../constants.ts";

export const download_artifact = defineTool({
  description: `Get the download URL for a workflow artifact by its ID. Returns a URL that can be used to download the artifact as a zip file.`,
  access: { risk: "read" },
  input: z.strictObject({
    repo: repoField,
    artifact_id: resourceId.describe("Artifact ID"),
  }),
  execute: async ({ repo, artifact_id }) => {
    const { url } = await octokit().rest.actions.downloadArtifact({
      owner: env.GITHUB_ORG,
      repo,
      artifact_id,
      archive_format: "zip",
    });
    return JSON.stringify({ download_url: url });
  },
});
