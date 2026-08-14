import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectRsvp } from "../../projections.ts";

export const get_rsvp = defineTool({
  description: "Fetch a single RSVP by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: "rsvps", id });
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
