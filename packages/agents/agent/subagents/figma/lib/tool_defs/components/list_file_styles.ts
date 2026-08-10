import type { GetFileStylesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey, summarizeStyle } from "../../constants.ts";

export const list_file_styles = defineTool({
  description: "List styles in a specific Figma file.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
  }),
  execute: async ({ file_key }) => {
    const data = await figma.get<GetFileStylesResponse>(`/v1/files/${file_key}/styles`);
    return {
      styles: data.meta.styles.map(summarizeStyle),
    };
  },
});
