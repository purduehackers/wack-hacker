import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";

export const delete_rsvp = defineTool({
  description:
    "Delete an RSVP permanently. Prefer `update_rsvp({ unsubscribed: true })` when the user just wants to opt out — deletion loses the audit trail.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({ collection: "rsvps", id });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
