import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape, projectShelter } from "../../constants.ts";

export const list_shelter_projects = defineTool({
  description:
    "List shelter wall project showcase entries. Each has name, last_division, last_owner, description, and a `visible` flag (true = shown publicly).",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    visible_only: z.boolean().optional(),
  }),
  execute: async ({ visible_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: "shelter-projects",
        ...paginationQuery(input),
        ...(visible_only && { where: { visible: { equals: true } } }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectShelter),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
