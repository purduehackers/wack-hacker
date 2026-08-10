import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";

export const create_customer_need = defineTool({
  description:
    "Create a customer request (feedback/need) attached to an issue or project. Links a customer to the work item with optional importance and body.",
  access: { risk: "write" },
  input: z.strictObject({
    issueId: z.string().exactOptional(),
    body: z.string().exactOptional(),
    priority: z.literal([0, 1]).exactOptional().describe("0=Not important, 1=Important"),
    customerId: z.string().exactOptional(),
    projectId: z.string().exactOptional(),
  }),
  execute: async (input) => {
    const payload = await linear.createCustomerNeed(input);
    const need = await payload.need;
    if (!need) return "Failed to create customer need";
    return JSON.stringify({ id: need.id });
  },
});

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
