import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { emailFields } from "../../constants.ts";
import { projectEmail } from "../../projections.ts";

export const update_email = defineTool({
  description:
    "Update an email draft's subject/body or retarget it to a different event. Does NOT fire the email — use `send_email` for that.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(emailFields).partial().shape }),
  execute: async ({ id, event_id, subject, body }) => {
    try {
      const data = {
        ...(event_id !== undefined && { event: event_id }),
        ...(subject !== undefined && { subject }),
        ...(body !== undefined && { body }),
      };
      const doc = await payload.update({
        collection: "emails",
        id,
        data,
      });
      return JSON.stringify(projectEmail(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
