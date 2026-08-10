import { deleteAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const delete_project = defineTool({
  description:
    "Permanently delete a Sentry project. This removes all issues, events, and configuration. Irreversible.",
  access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await deleteAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    unwrapResult(result, "deleteProject");
    return JSON.stringify({ deleted: true, project_slug });
  },
});
