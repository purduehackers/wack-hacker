import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const update_document = defineTool({
  description:
    "Update a document's Markdown content or move it to a different parent entity. Only include fields to change.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    content: z.string().exactOptional(),
    projectId: z.string().exactOptional(),
    initiativeId: z.string().exactOptional(),
    issueId: z.string().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateDocument(id, input);
    const doc = await payload.document;
    if (!doc) return "Failed to update document";
    return JSON.stringify({ id: doc.id, title: doc.title, url: doc.url });
  },
});
