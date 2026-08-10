import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { projectShelter, shelterProjectFields } from "../../constants.ts";

export const create_shelter_project = defineTool({
  description:
    "Create a new shelter project. `image_id` must point at an existing media asset (upload via `upload_media` first). Defaults to visible: false — flip with `publish_shelter_project` when ready.",
  access: { risk: "write" },
  input: z.strictObject(shelterProjectFields),
  execute: async ({ image_id, visible, ...rest }) => {
    try {
      const doc = await payload.create({
        collection: "shelter-projects",
        data: { ...rest, image: image_id, visible: visible ?? false },
      });
      return JSON.stringify(projectShelter(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
