import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { rsvpFields } from "../../constants.ts";
import { projectRsvp } from "../../projections.ts";

export const create_rsvp = defineTool({
  description: "Create an RSVP for an event on behalf of a user.",
  access: { risk: "write" },
  input: z.strictObject(rsvpFields),
  execute: async ({ event_id, email, name, unsubscribed }) => {
    try {
      const doc = await payload.create({
        collection: "rsvps",
        data: {
          event: event_id,
          email,
          name,
          unsubscribed: unsubscribed ?? false,
        },
      });
      return JSON.stringify(projectRsvp(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
