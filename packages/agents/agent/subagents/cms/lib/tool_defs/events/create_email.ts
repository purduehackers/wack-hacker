import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { emailFields } from "../../constants.ts";
import { projectEmail } from "../../projections.ts";

export const create_email = defineTool({
  description:
    "Draft a new email blast tied to an event. `send: false` by default — the message won't fire until `send_email` flips the flag. Use this to prepare copy before getting approval to send.",
  access: { risk: "write" },
  input: z.strictObject(emailFields),
  execute: async ({ event_id, subject, body }) => {
    try {
      const doc = await payload.create({
        collection: "emails",
        data: { event: event_id, subject, body, send: false },
      });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
