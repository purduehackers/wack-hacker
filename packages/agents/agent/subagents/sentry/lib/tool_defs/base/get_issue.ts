import { retrieveAnIssue, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

const issueProjectionSchema = z.looseObject({ priority: z.string().nullish().catch(undefined) });

export const get_issue = defineTool({
  description:
    "Get full details for a Sentry issue by its numeric ID. Returns title, metadata, status, assignee, tags, first/last seen, and activity.",
  access: { risk: "read" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const result = await retrieveAnIssue({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id,
      },
    });
    const { data } = unwrapResult(result, "getIssue");
    const d = data;
    const projection = issueProjectionSchema.parse(data);
    return JSON.stringify({
      id: d.id,
      shortId: d.shortId,
      title: d.title,
      culprit: d.culprit,
      status: d.status,
      level: d.level,
      count: d.count,
      userCount: d.userCount,
      firstSeen: d.firstSeen,
      lastSeen: d.lastSeen,
      permalink: d.permalink,
      assignedTo: d.assignedTo,
      project: d.project?.slug,
      metadata: d.metadata,
      type: d.type,
      priority: projection.priority,
    });
  },
});
