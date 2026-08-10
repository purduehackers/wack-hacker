import { listARelease_sDeploys, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_release_deploys = defineTool({
  description: "List deploys for a Sentry release. Shows environment, dates, and deploy name.",
  access: { risk: "read" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
  }),
  execute: async ({ version }) => {
    const result = await listARelease_sDeploys({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
    });
    const { data } = unwrapResult(result, "listReleaseDeploys");
    return JSON.stringify(data);
  },
});
