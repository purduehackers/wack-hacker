import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape } from "../../constants.ts";
import { projectMedia } from "../../projections.ts";

export const list_media = defineTool({
  description:
    "List media assets uploaded to Payload CMS. Supports filtering by `source` ('manual' / 'hack-night') and `batch_id` (to group hack-night uploads).",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    source: z.string().optional(),
    batch_id: z.string().optional(),
  }),
  execute: async ({ source, batch_id, ...input }) => {
    try {
      const where = {
        ...(source !== undefined && { source: { equals: source } }),
        ...(batch_id !== undefined && { batchId: { equals: batch_id } }),
      };
      const res = await payload.find({
        collection: "media",
        ...paginationQuery(input),
        ...(Object.keys(where).length > 0 && { where }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectMedia),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
