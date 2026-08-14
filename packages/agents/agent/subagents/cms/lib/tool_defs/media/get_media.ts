import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectMedia } from "../../projections.ts";

export const get_media = defineTool({
  description: "Fetch a single media asset by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({ collection: "media", id });
      return JSON.stringify(projectMedia(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
