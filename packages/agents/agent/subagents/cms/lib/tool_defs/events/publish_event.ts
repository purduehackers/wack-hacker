import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectEvent } from "../../constants.ts";

export const publish_event = defineTool({
  description: "Mark an event as published (visible on the website).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "events",
        id,
        data: { published: true },
      });
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
