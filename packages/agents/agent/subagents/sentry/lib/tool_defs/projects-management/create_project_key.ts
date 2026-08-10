import { createANewClientKey, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_project_key = defineTool({
  description: "Create a new client key (DSN) for a Sentry project. Returns the new DSN.",
  access: { risk: "write" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    name: z.string().describe("Human-readable label for the key"),
  }),
  execute: async ({ project_slug, name }) => {
    const result = await createANewClientKey({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      body: { name },
    });
    const { data } = unwrapResult(result, "createKey");
    return JSON.stringify(data);
  },
});
