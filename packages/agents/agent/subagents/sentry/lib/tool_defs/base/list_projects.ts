import { listAnOrganization_sProjects, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

// These projections exist only to read a field the generated SDK type omits, so
// an unexpected shape must degrade to "absent" rather than fail the whole tool.
const projectProjectionSchema = z.looseObject({ status: z.string().nullish().catch(undefined) });

export const list_projects = defineTool({
  description:
    "List all projects in the Sentry organization. Returns slug, name, platform, date created, and status.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await listAnOrganization_sProjects({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
    });
    const { data } = unwrapResult(result, "listProjects");
    return JSON.stringify(
      data.map((project) => ({
        id: project.id,
        slug: project.slug,
        name: project.name,
        platform: project.platform,
        dateCreated: project.dateCreated,
        status: projectProjectionSchema.parse(project).status,
      })),
    );
  },
});
