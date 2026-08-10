import { retrieveAnIssueEvent, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { sentryNumericId } from "../../constants.ts";

export const get_latest_event = defineTool({
  description:
    "Get the most recent event for a Sentry issue. Returns full event detail including stack trace and breadcrumbs.",
  access: { risk: "read" },
  input: z.strictObject({
    issue_id: sentryNumericId.describe("Sentry issue ID (numeric)"),
  }),
  execute: async ({ issue_id }) => {
    const result = await retrieveAnIssueEvent({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        issue_id: Number(issue_id),
        event_id: "latest",
      },
    });
    const { data } = unwrapResult(result, "getLatestEvent");
    const d = data;
    return JSON.stringify({
      eventID: d.eventID,
      title: d.title,
      message: d.message,
      dateCreated: d.dateCreated,
      tags: d.tags,
      contexts: d.contexts,
      entries: d.entries,
      user: d.user,
      sdk: d.sdk,
    });
  },
});
