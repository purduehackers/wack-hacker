import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";

export const delete_media = defineTool({
  description:
    "Delete a media asset permanently. Referenced pages/posts will lose their image until relinked.",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({ collection: "media", id });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
