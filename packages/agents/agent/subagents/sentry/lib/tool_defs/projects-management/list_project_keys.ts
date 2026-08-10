import { listAProject_sClientKeys, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_project_keys = defineTool({
  description:
    "List client keys (DSNs) for a Sentry project. Each key has a public DSN used by SDKs to send events.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await listAProject_sClientKeys({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listKeys");
    return JSON.stringify(
      data.map((k) => ({
        id: k.id,
        label: k.label,
        isActive: k.isActive,
        public: k.dsn?.public,
        dateCreated: k.dateCreated,
      })),
    );
  },
});
