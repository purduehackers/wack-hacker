import { deleteAClientKey, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const delete_project_key = defineTool({
  description:
    "Delete a Sentry client key (DSN). All SDKs using this key will stop sending events. Irreversible.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    key_id: z.string().describe("Client key ID"),
  }),
  execute: async ({ project_slug, key_id }) => {
    const result = await deleteAClientKey({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        key_id,
      },
    });
    unwrapResult(result, "deleteKey");
    return JSON.stringify({ deleted: true, key_id });
  },
});
