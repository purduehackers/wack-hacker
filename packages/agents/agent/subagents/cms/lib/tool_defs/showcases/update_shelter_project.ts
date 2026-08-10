import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectShelter, shelterProjectFields } from "../../constants.ts";

export const update_shelter_project = defineTool({
  description: "Update a shelter project. Only fields you pass are changed.",
  access: { risk: "write" },
  input: z.strictObject({
    id: documentId,
    ...z.object(shelterProjectFields).partial().shape,
  }),
  execute: async ({ id, image_id, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(image_id !== undefined && { image: image_id }),
      };
      const doc = await payload.update({
        collection: "shelter-projects",
        id,
        data,
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
