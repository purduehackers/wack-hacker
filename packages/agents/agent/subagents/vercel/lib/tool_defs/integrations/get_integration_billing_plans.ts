import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_integration_billing_plans = defineTool({
  description:
    "List billing plans for a specific product of an integration. Use the returned plan id in `create_integration_store_direct`.",
  access: { risk: "read" },
  input: z.strictObject({
    integration_id_or_slug: z
      .string()
      .describe("The integration slug/id (e.g. 'turso', 'upstash')"),
    product_id_or_slug: z.string().describe("The product slug/id (e.g. 'database', 'kv')"),
    integration_configuration_id: z.string().optional(),
  }),
  execute: async ({ integration_id_or_slug, product_id_or_slug, integration_configuration_id }) => {
    const result = await vercel().integrations.getBillingPlans({
      ...TEAM,
      integrationIdOrSlug: integration_id_or_slug,
      productIdOrSlug: product_id_or_slug,
      integrationConfigurationId: integration_configuration_id,
    });
    return JSON.stringify(result);
  },
});
