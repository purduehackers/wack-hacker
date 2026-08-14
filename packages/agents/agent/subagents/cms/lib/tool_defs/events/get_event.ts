import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectEvent } from "../../projections.ts";

export const get_event = defineTool({
  description: "Fetch a single event by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId.describe("Event ID") }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: "events", id });
      return JSON.stringify(projectEvent(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
