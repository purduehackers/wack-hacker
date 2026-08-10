import { retrieveAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_project = defineTool({
  description:
    "Get full details for a Sentry project — platform, team, features, date created, and configuration.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug (e.g. 'my-nextjs-app')"),
  }),
  execute: async ({ project_slug }) => {
    const result = await retrieveAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "getProject");
    return JSON.stringify(data);
  },
});
