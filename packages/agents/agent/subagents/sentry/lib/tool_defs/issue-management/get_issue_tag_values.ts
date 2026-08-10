import { listATag_sValuesForAnIssue, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const get_issue_tag_values = defineTool({
  description: "Get values for a specific tag on a Sentry issue, with occurrence counts.",
  access: { risk: "read" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
    tag_key: z.string().describe("Tag key (e.g. 'browser', 'os', 'environment')"),
  }),
  execute: async ({ issue_id, tag_key }) => {
    const result = await listATag_sValuesForAnIssue({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id: Number(issue_id),
        key: tag_key,
      },
    });
    const { data } = unwrapResult(result, "getIssueTagValues");
    return JSON.stringify(
      data.map((v) => ({
        value: v.value,
        name: v.name,
        count: v.count,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
      })),
    );
  },
});
