import type { GetComponentSetResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { summarizeComponent } from "../../constants.ts";

export const get_component_set = defineTool({
  description: "Get full details of a published component set by its key.",
  access: { risk: "read" },
  input: z.strictObject({
    component_set_key: z.string().describe("The component set key"),
  }),
  execute: async ({ component_set_key }) => {
    const data = await figma.get<GetComponentSetResponse>(
      `/v1/component_sets/${component_set_key}`,
    );
    return summarizeComponent(data.meta);
  },
});
