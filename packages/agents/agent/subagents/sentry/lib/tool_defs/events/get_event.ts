import { retrieveAnEventForAProject, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";

export const get_event = defineTool({
  description:
    "Get full event detail including stack trace, breadcrumbs, and contexts. Requires both project slug and event ID.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    event_id: z.string().describe("Event ID"),
  }),
  execute: async ({ project_slug, event_id }) => {
    const result = await retrieveAnEventForAProject({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
        event_id,
      },
    });
    const { data } = unwrapResult(result, "getEvent");
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
