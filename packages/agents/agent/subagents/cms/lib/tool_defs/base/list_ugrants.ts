import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape } from "../../constants.ts";
import { projectUgrant } from "../../projections.ts";

export const list_ugrants = defineTool({
  description:
    'List microgrant ("ugrant") showcase entries. Each has name, author, description, project/author URLs, and a `visible` flag (true = shown publicly).',
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    visible_only: z.boolean().optional(),
  }),
  execute: async ({ visible_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: "ugrants",
        ...paginationQuery(input),
        ...(visible_only && { where: { visible: { equals: true } } }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectUgrant),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
