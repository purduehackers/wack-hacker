import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_customer_needs = defineTool({
  description: "List all customer requests with priority and creation date.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const r = await linear.customerNeeds();
    return JSON.stringify(
      r.nodes.map((n) => ({ id: n.id, priority: n.priority, createdAt: n.createdAt })),
    );
  },
});
