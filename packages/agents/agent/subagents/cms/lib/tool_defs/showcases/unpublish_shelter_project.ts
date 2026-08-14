import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectShelter } from "../../projections.ts";

export const unpublish_shelter_project = defineTool({
  description: "Hide a shelter project from the public showcase (visible: false).",
  access: { risk: "destructive" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.update({
        collection: "shelter-projects",
        id,
        data: { visible: false },
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
