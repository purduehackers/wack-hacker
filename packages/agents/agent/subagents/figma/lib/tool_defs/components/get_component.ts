import type { GetComponentResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeComponent } from "../../constants.ts";

export const get_component = defineTool({
  description: "Get full details of a published component by its key.",
  access: { risk: "read" },
  input: z.strictObject({
    component_key: z.string().describe("The component key"),
  }),
  execute: async ({ component_key }) => {
    const data = await figma.get<GetComponentResponse>(`/v1/components/${component_key}`);
    return summarizeComponent(data.meta);
  },
});
