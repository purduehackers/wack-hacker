import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const update_customer_need = defineTool({
  description: "Update a customer request.",
  access: { risk: "write" },
  input: z.strictObject({
    id: z.string(),
    body: z.string().exactOptional(),
    priority: z.literal([0, 1]).exactOptional().describe("0=Not important, 1=Important"),
    customerId: z.string().exactOptional(),
    issueId: z.string().exactOptional(),
    projectId: z.string().exactOptional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateCustomerNeed(id, input);
    return JSON.stringify({ success: payload.success });
  },
});
