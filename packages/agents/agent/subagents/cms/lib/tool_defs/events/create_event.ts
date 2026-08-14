import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { eventFields } from "../../constants.ts";
import { projectEvent, richTextParagraph } from "../../projections.ts";

export const create_event = defineTool({
  description:
    "Create a new event. `description` accepts plain text and is wrapped as a single Lexical paragraph. Set `published: true` only when the event is ready to appear on the website.",
  access: { risk: "write" },
  input: z.strictObject(eventFields),
  execute: async ({ event_type, description, ...rest }) => {
    try {
      const data = {
        ...rest,
        eventType: event_type ?? "hack-night",
        description: richTextParagraph(description),
        published: rest.published ?? false,
      };
      const doc = await payload.create({ collection: "events", data });
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
