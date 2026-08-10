import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectEvent } from "../../constants.ts";

export const send_blast = defineTool({
  description:
    "Fire the email blast for this event to all active RSVPs (sets `send: true`). Payload's afterChange hook sends real emails via Resend and resets `send` to false afterwards. Destructive external side effect — use only after explicit confirmation.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "events",
        id,
        data: { send: true },
      });
      return JSON.stringify({ triggered: true, ...projectEvent(doc) });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
