import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape, projectSession } from "../../constants.ts";

export const list_hack_night_sessions = defineTool({
  description:
    "List hack night session records. Each has a title, date, host {preferred_name, discord_id}, and published flag.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    published_only: z.boolean().optional(),
  }),
  execute: async ({ published_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: "hack-night-sessions",
        ...paginationQuery(input),
        ...(published_only ? { where: { published: { equals: true } } } : {}),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectSession),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
