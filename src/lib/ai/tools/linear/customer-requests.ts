import { tool } from "ai";
import { z } from "zod";

import { linear } from "./client.ts";

export const create_customer_need = tool({
  description:
    "Create a customer request (feedback/need) attached to an issue or project. Links a customer to the work item with optional importance and body.",
  inputSchema: z.object({
    issueId: z.string().optional(),
    body: z.string().optional(),
    priority: z.number().optional().describe("0=Not important, 1=Important"),
    customerId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  execute: async (input) => {
    const payload = await linear.createCustomerNeed(input);
    const need = await payload.need;
    if (!need) return "Failed to create customer need";
    return JSON.stringify({ id: need.id });
  },
});

export const update_customer_need = tool({
  description: "Update a customer request.",
  inputSchema: z.object({
    id: z.string(),
    body: z.string().optional(),
    priority: z.number().optional().describe("0=Not important, 1=Important"),
    customerId: z.string().optional(),
    issueId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateCustomerNeed(id, input);
    return JSON.stringify({ success: payload.success });
  },
});

export const list_customer_needs = tool({
  description: "List all customer requests with priority and creation date.",
  inputSchema: z.object({}),
  execute: async () => {
    const r = await linear.customerNeeds();
    return JSON.stringify(
      r.nodes.map((n) => ({ id: n.id, priority: n.priority, createdAt: n.createdAt })),
    );
  },
});
