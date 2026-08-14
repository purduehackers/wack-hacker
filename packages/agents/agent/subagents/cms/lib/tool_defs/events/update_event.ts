import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { eventFields } from "../../constants.ts";
import { projectEvent, richTextParagraph } from "../../projections.ts";

export const update_event = defineTool({
  description:
    "Update an event by ID. Only fields you pass are changed. `description` (if set) is wrapped as a single Lexical paragraph — omit it when you don't want to overwrite existing richText.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(eventFields).partial().shape }),
  execute: async ({ id, event_type, description, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(event_type !== undefined && { eventType: event_type }),
        ...(description !== undefined && { description: richTextParagraph(description) }),
      };
      const doc = await payload.update({
        collection: "events",
        id,
        data,
      });
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
