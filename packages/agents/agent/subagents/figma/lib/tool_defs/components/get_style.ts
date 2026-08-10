import type { GetStyleResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeStyle } from "../../constants.ts";

export const get_style = defineTool({
  description: "Get full details of a published style by its key.",
  access: { risk: "read" },
  input: z.strictObject({
    style_key: z.string().describe("The style key"),
  }),
  execute: async ({ style_key }) => {
    const data = await figma.get<GetStyleResponse>(`/v1/styles/${style_key}`);
    return summarizeStyle(data.meta);
  },
});
