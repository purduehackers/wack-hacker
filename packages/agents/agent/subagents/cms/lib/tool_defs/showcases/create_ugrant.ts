import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { projectUgrant, ugrantFields } from "../../constants.ts";

export const create_ugrant = defineTool({
  description:
    "Create a new ugrant showcase entry. `image_id` must point at an existing media asset (upload via `upload_media` first). Defaults to visible: false — flip with `publish_ugrant` when ready.",
  access: { risk: "write" },
  input: z.strictObject(ugrantFields),
  execute: async ({ image_id, author_url, project_url, visible, ...rest }) => {
    try {
      const doc = await payload.create({
        collection: "ugrants",
        data: {
          ...rest,
          image: image_id,
          ...(author_url !== undefined && { authorUrl: author_url }),
          ...(project_url !== undefined && { projectUrl: project_url }),
          visible: visible ?? false,
        },
      });
      return JSON.stringify(projectUgrant(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
