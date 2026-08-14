import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectSession } from "../../projections.ts";

export const get_hack_night_session = defineTool({
  description: "Fetch a single hack night session by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: "hack-night-sessions",
        id,
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
