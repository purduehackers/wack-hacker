import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectUgrant } from "../../constants.ts";

export const get_ugrant = defineTool({
  description: "Fetch a single ugrant by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: "ugrants", id });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
