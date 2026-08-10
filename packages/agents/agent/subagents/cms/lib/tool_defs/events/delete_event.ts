import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";

export const delete_event = defineTool({
  description: "Delete an event permanently. Also detaches RSVPs and sent-email records.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({ collection: "events", id });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
