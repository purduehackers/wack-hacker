import { deprecatedListAProject_sIssueAlertRules, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const list_alert_rules = defineTool({
  description: "List issue alert rules for a Sentry project.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
  }),
  execute: async ({ project_slug }) => {
    const result = await deprecatedListAProject_sIssueAlertRules({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
    });
    const { data } = unwrapResult(result, "listAlertRules");
    return JSON.stringify(
      data.map((r) => ({
        id: r.id,
        name: r.name,
        dateCreated: r.dateCreated,
        actionMatch: r.actionMatch,
        frequency: r.frequency,
        environment: r.environment,
        status: r.status,
        conditionCount: r.conditions.length,
        actionCount: r.actions.length,
      })),
    );
  },
});
