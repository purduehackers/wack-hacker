import { listAProject_sEnvironments, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_project_environments = defineTool({
  description:
    "List environments configured for a Sentry project. Returns name, is_hidden, and environment ID.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await listAProject_sEnvironments({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listEnvironments");
    return JSON.stringify(data);
  },
});
