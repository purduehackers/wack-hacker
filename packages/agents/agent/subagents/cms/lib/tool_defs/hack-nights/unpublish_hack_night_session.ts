import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectSession } from "../../constants.ts";

export const unpublish_hack_night_session = defineTool({
  description: "Unpublish a hack night session.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "hack-night-sessions",
        id,
        data: { published: false },
      });
      return JSON.stringify(projectSession(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
