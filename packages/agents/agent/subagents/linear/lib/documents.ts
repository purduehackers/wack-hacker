import { z } from "zod";

import { linear } from "./client.ts";
import { defineTool } from "./define-tool.ts";
import { sdkInput } from "./sdk-input.ts";

export const create_document = defineTool({
  name: "create_document",
  domain: "linear",
  description:
    "Create a Markdown document attached to exactly one parent: a project, initiative, issue, or cycle. Requires title and at least one parent ID.",
  access: { risk: "write" },
  input: z.object({
    title: z.string(),
    content: z.string().optional(),
    projectId: z.string().optional(),
    initiativeId: z.string().optional(),
    issueId: z.string().optional(),
    cycleId: z.string().optional(),
    teamId: z.string().optional(),
  }),
  execute: async (input) => {
    const payload = await linear.createDocument(
      sdkInput<Parameters<typeof linear.createDocument>[0]>(input),
    );
    const doc = await payload.document;
    if (!doc) return "Failed to create document";
    return JSON.stringify({ id: doc.id, title: doc.title, url: doc.url });
  },
});

export const update_document = defineTool({
  name: "update_document",
  domain: "linear",
  description:
    "Update a document's Markdown content or move it to a different parent entity. Only include fields to change.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    content: z.string().optional(),
    projectId: z.string().optional(),
    initiativeId: z.string().optional(),
    issueId: z.string().optional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateDocument(
      id,
      sdkInput<Parameters<typeof linear.updateDocument>[1]>(input),
    );
    const doc = await payload.document;
    if (!doc) return "Failed to update document";
    return JSON.stringify({ id: doc.id, title: doc.title, url: doc.url });
  },
});
