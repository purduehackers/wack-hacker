import { createADeploy, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const create_deploy = defineTool({
  description:
    "Record a deploy for a Sentry release. Requires an environment name (e.g. 'production', 'staging').",
  access: { risk: "write" },
  input: z.strictObject({
    version: z.string().describe("Release version"),
    environment: z.string().describe("Environment name (e.g. 'production')"),
    date_started: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 deploy start timestamp, e.g. 2024-05-01T18:30:00Z"),
    date_finished: z.iso
      .datetime({ offset: true })
      .optional()
      .describe("ISO 8601 deploy finish timestamp, e.g. 2024-05-01T18:35:00Z"),
    name: z.string().optional().describe("Optional deploy name"),
  }),
  execute: async ({ version, environment, date_started, date_finished, name }) => {
    const result = await createADeploy({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        version,
      },
      body: {
        environment,
        ...(date_started === undefined ? {} : { dateStarted: date_started }),
        ...(date_finished === undefined ? {} : { dateFinished: date_finished }),
        ...(name === undefined ? {} : { name }),
      },
    });
    const { data } = unwrapResult(result, "createDeploy");
    return JSON.stringify(data);
  },
});
