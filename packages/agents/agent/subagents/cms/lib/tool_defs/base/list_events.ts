import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape } from "../../constants.ts";
import { projectEvent } from "../../projections.ts";

export const list_events = defineTool({
  description:
    "List events from the CMS. Supports pagination and sort (prefix field with '-' for descending, e.g. '-start'). Includes published flag, start/end, location, and email-send status.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    published_only: z
      .boolean()
      .optional()
      .describe("When true, return only events with published === true"),
  }),
  execute: async ({ published_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: "events",
        ...paginationQuery(input),
        ...(published_only && { where: { published: { equals: true } } }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectEvent),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
