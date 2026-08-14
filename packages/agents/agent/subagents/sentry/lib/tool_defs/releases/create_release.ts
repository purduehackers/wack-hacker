import { createANewReleaseForAnOrganization, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_release = defineTool({
  description:
    "Create a new Sentry release. Requires a version string and at least one project slug.",
  access: { risk: "write" },
  input: z.strictObject({
    version: z.string().describe("Release version string"),
    projects: z.array(z.string()).describe("Project slugs to associate with this release"),
    ref: z.string().optional().describe("Git ref (commit SHA or tag)"),
    date_released: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 release timestamp, e.g. 2024-05-01T18:30:00Z"),
  }),
  execute: async ({ version, projects, ref, date_released }) => {
    const result = await createANewReleaseForAnOrganization({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      body: {
        version,
        projects,
        ...(ref !== undefined && { ref }),
        ...(date_released !== undefined && { dateReleased: date_released }),
      },
    });
    const { data } = unwrapResult(result, "createRelease");
    return JSON.stringify(data);
  },
});
