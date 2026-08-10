import { retrieveAnOrganization_sRelease, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_release = defineTool({
  description: "Get full details for a Sentry release by version string.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version (e.g. '1.0.0' or a commit SHA)"),
  }),
  execute: async ({ version }) => {
    const result = await retrieveAnOrganization_sRelease({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "getRelease");
    return JSON.stringify(data);
  },
});
