import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectRsvp, rsvpFields } from "../../constants.ts";

export const update_rsvp = defineTool({
  description:
    "Update an RSVP. Commonly used to toggle `unsubscribed: true` when someone asks off the list.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(rsvpFields).partial().shape }),
  execute: async ({ id, event_id, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(event_id !== undefined && { event: event_id }),
      };
      const doc = await payload.update({
        collection: "rsvps",
        id,
        data,
      });
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
