import { listAnOrganizationRelease_sCommits, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

// Read-only projection over fields the generated SDK type omits: an unexpected
// shape must degrade to "absent" rather than fail the tool.
const releaseCommitProjectionSchema = z.looseObject({
  // `.catch` keeps the "can never fail" property the previous `z.unknown()` had:
  // `z.json()` rejects a shape Sentry might introduce, and this projection is
  // read through a throwing `.parse`.
  author: z.json().optional().catch(undefined),
  repository: z
    .looseObject({ name: z.string().nullish().catch(undefined) })
    .nullish()
    .catch(undefined),
});

export const list_release_commits = defineTool({
  description: "List commits associated with a Sentry release.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
  }),
  execute: async ({ version }) => {
    const result = await listAnOrganizationRelease_sCommits({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "listReleaseCommits");
    return JSON.stringify(
      data.map((commit) => {
        const projection = releaseCommitProjectionSchema.parse(commit);
        return {
          id: commit.id,
          message: commit.message,
          dateCreated: commit.dateCreated,
          author: projection.author,
          repository: projection.repository?.name,
        };
      }),
    );
  },
});
