import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { ugrantFields } from "../../constants.ts";
import { projectUgrant } from "../../projections.ts";

export const update_ugrant = defineTool({
  description: "Update a ugrant. Only fields you pass are changed.",
  access: { risk: "write" },
  input: z.strictObject({ id: documentId, ...z.object(ugrantFields).partial().shape }),
  execute: async ({ id, image_id, author_url, project_url, ...rest }) => {
    try {
      const data = {
        ...rest,
        ...(image_id !== undefined && { image: image_id }),
        ...(author_url !== undefined && { authorUrl: author_url }),
        ...(project_url !== undefined && { projectUrl: project_url }),
      };
      const doc = await payload.update({
        collection: "ugrants",
        id,
        data,
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
