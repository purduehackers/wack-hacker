import type { GetFileComponentsResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey, summarizeComponent } from "../../constants.ts";

export const list_file_components = defineTool({
  description: "List components in a specific Figma file.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetFileComponentsResponse>(`/v1/files/${file_key}/components`);
    return {
      components: data.meta.components.map(summarizeComponent),
    };
  },
});
