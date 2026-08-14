import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectEmail } from "../../projections.ts";

export const send_email = defineTool({
  description:
    "Fire the email blast (flips `send: true`, Payload's afterChange hook dispatches the real emails via Cloudflare, then resets send to false). Destructive external side effect — confirm the draft is final before calling.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "emails",
        id,
        data: { send: true },
      });
      return JSON.stringify({ triggered: true, ...projectEmail(doc) });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
