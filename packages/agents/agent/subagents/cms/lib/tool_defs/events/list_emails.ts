import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape, projectEmail } from "../../constants.ts";

export const list_emails = defineTool({
  description:
    "List email blast records. These are the `emails` collection rows — each is a subject/body tied to an event, with a `send` flag and `sentAt` timestamp when fired.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    event_id: documentId.optional().describe("Filter to emails tied to a specific event"),
  }),
  execute: async ({ event_id, ...input }) => {
    try {
      const res = await payload.find({
        collection: "emails",
        ...paginationQuery(input),
        ...(event_id !== undefined ? { where: { event: { equals: event_id } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectEmail),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
