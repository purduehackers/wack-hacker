import { createANewProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_project = defineTool({
  description:
    "Create a new Sentry project under a team. Platform is the language/framework slug (e.g. 'javascript-nextjs', 'python-django', 'go'). Returns the new project's id, slug, and first DSN.",
  access: { risk: "write", minRole: "admin" },
  input: z.strictObject({
    team_slug: z.string().describe("Team slug that will own the project"),
    name: z.string().describe("Project name"),
    slug: z.string().optional().describe("Project slug (auto-generated from name if omitted)"),
    platform: z.string().optional().describe("Platform identifier (e.g. 'javascript-nextjs')"),
  }),
  execute: async ({ team_slug, name, slug, platform }) => {
    const result = await createANewProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        team_id_or_slug: team_slug,
      },
      body: {
        name,
        ...(slug !== undefined && { slug }),
        ...(platform !== undefined && { platform }),
      },
    });
    const { data } = unwrapResult(result, "createProject");
    return JSON.stringify(data);
  },
});
