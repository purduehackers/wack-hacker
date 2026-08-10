import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectEmail } from "../../constants.ts";

export const get_email = defineTool({
  description: "Fetch a single email blast record by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: "emails", id });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
