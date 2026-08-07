import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { linear } from "./client.ts";
import { sdkInput } from "./sdk-input.ts";

export const create_customer_need = defineTool({
  description:
    "Create a customer request (feedback/need) attached to an issue or project. Links a customer to the work item with optional importance and body.",
  access: { risk: "write" },
  input: z.object({
    issueId: z.string().optional(),
    body: z.string().optional(),
    priority: z.number().optional().describe("0=Not important, 1=Important"),
    customerId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  execute: async (input) => {
    const payload = await linear.createCustomerNeed(
      sdkInput<Parameters<typeof linear.createCustomerNeed>[0]>(input),
    );
    const need = await payload.need;
    if (!need) return "Failed to create customer need";
    return JSON.stringify({ id: need.id });
  },
});

export const update_customer_need = defineTool({
  description: "Update a customer request.",
  access: { risk: "write" },
  input: z.object({
    id: z.string(),
    body: z.string().optional(),
    priority: z.number().optional().describe("0=Not important, 1=Important"),
    customerId: z.string().optional(),
    issueId: z.string().optional(),
    projectId: z.string().optional(),
  }),
  execute: async ({ id, ...input }) => {
    const payload = await linear.updateCustomerNeed(
      id,
      sdkInput<Parameters<typeof linear.updateCustomerNeed>[1]>(input),
    );
    return JSON.stringify({ success: payload.success });
  },
});

export const list_customer_needs = defineTool({
  description: "List all customer requests with priority and creation date.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const r = await linear.customerNeeds();
    return JSON.stringify(
      r.nodes.map((n) => ({ id: n.id, priority: n.priority, createdAt: n.createdAt })),
    );
  },
});
