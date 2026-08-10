import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectUgrant } from "../../constants.ts";

export const publish_ugrant = defineTool({
  description: "Make a ugrant visible on the public showcase (visible: true).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "ugrants",
        id,
        data: { visible: true },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
