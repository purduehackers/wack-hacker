import { tool } from "ai";
import { z } from "zod";

import { linear } from "./client.ts";

export const create_document = tool({
  description:
    "Create a Markdown document attached to exactly one parent: a project, initiative, issue, or cycle. Requires title and at least one parent ID.",
  inputSchema: z.object({
    title: z.string(),
    content: z.string().optional(),
    projectId: z.string().optional(),
    initiativeId: z.string().optional(),
    issueId: z.string().optional(),
    cycleId: z.string().optional(),
    teamId: z.string().optional(),
  }),
  execute: async (input) => {
    const payload = await linear.createDocument(input);
    const doc = await payload.document;
    if (!doc) return "Failed to create document";
    return JSON.stringify({ id: doc.id, title: doc.title, url: doc.url });
  },
});

export const update_document = tool({
  description:
    "Update a document's Markdown content or move it to a different parent entity. Only include fields to change.",
  inputSchema: z.object({
    id: z.string(),
    content: z.string().optional(),
    projectId: z.string().optional(),
    initiativeId: z.string().optional(),
    issueId: z.string().optional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateDocument(id, input);
    const doc = await payload.document;
    if (!doc) return "Failed to update document";
    return JSON.stringify({ id: doc.id, title: doc.title, url: doc.url });
  },
});
