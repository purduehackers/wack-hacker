import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectUgrant } from "../../projections.ts";

export const unpublish_ugrant = defineTool({
  description: "Hide a ugrant from the public showcase (visible: false).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "ugrants",
        id,
        data: { visible: false },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
