import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape, projectRsvp } from "../../constants.ts";

export const list_rsvps = defineTool({
  description:
    "List RSVPs across events. Optionally filter by event_id, email, or unsubscribed flag. Useful for attendance reports and unsubscribe audits.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    event_id: documentId.optional(),
    email: z.email().optional(),
    unsubscribed: z.boolean().optional().describe("Filter by unsubscribed status (true/false)"),
  }),
  execute: async ({ event_id, email, unsubscribed, ...input }) => {
    try {
      const where = {
        ...(event_id !== undefined && { event: { equals: event_id } }),
        ...(email !== undefined && { email: { equals: email } }),
        ...(unsubscribed !== undefined && { unsubscribed: { equals: unsubscribed } }),
      };
      const res = await payload.find({
        collection: "rsvps",
        ...paginationQuery(input),
        ...(Object.keys(where).length > 0 ? { where } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectRsvp),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
