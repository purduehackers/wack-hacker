import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const delete_dev_resource = defineTool({
  description: "Delete a dev resource from a Figma file.",
  access: { risk: "destructive" },
  input: z.strictObject({
    file_key: fileKey,
    dev_resource_id: z.string().describe("The dev resource ID to delete"),
  }),
  execute: async ({ file_key, dev_resource_id }) => {
    await figma.delete(`/v1/files/${file_key}/dev_resources/${dev_resource_id}`);
    return { deleted: true };
  },
});
