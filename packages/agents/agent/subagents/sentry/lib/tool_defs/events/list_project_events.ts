import { listAProject_sErrorEvents, unwrapResult } from "@sentry/api";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { sentryOpts, sentryOrg } from "../../client.ts";
import { perPageField } from "../../constants.ts";

export const list_project_events = defineTool({
  description:
    "List recent events for a Sentry project. Returns event ID, title, timestamp, and tags.",
  access: { risk: "read" },
  input: z.strictObject({
    project_slug: z.string().describe("Project slug"),
    query: z.string().optional().describe("Search query to filter events"),
    per_page: perPageField,
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  execute: async ({ project_slug, cursor }) => {
    const result = await listAProject_sErrorEvents({
      ...sentryOpts(),
      path: {
        organization_id_or_slug: sentryOrg(),
        project_id_or_slug: project_slug,
      },
      query: cursor === undefined ? {} : { cursor },
    });
    const { data } = unwrapResult(result, "listProjectEvents");
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
