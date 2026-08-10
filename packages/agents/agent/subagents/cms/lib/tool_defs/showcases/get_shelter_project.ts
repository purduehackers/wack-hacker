import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectShelter } from "../../constants.ts";

export const get_shelter_project = defineTool({
  description: "Fetch a single shelter project by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: "shelter-projects",
        id,
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
