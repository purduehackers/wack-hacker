import { createANewTeam, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_team = defineTool({
  description: "Create a new team in the Sentry organization.",
  access: { risk: "write", minRole: "admin" },
  input: z.strictObject({
    name: z.string().describe("Team name"),
    slug: z.string().optional().describe("Team slug (auto-generated from name if omitted)"),
  }),
  execute: async ({ name, slug }) => {
    const result = await createANewTeam({
      ...sentryOpts(),
      path: { organization_id_or_slug: sentryOrg() },
      body: { name, ...(slug !== undefined && { slug }) },
    });
    const { data } = unwrapResult(result, "createTeam");
    return JSON.stringify(data);
  },
});
