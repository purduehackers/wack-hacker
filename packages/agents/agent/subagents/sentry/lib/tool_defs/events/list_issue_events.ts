import { listAnIssue_sEvents, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const list_issue_events = defineTool({
  description:
    "List events (occurrences) for a Sentry issue. Returns event ID, title, timestamp, and tags.",
  access: { risk: "read" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ issue_id, cursor }) => {
    const result = await listAnIssue_sEvents({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id: Number(issue_id),
      },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listIssueEvents");
    return JSON.stringify(
      data.map((e) => ({
        eventID: e.eventID,
        title: e.title,
        message: e.message,
        dateCreated: e.dateCreated,
        tags: e.tags,
      })),
    );
  },
});
