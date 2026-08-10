import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const create_integration_store_direct = defineTool({
  description:
    "Provision a new integration resource — e.g. a Turso database, Upstash Redis, Neon Postgres, Vercel Blob. Returns a resource id to pass to `connect_integration_resource_to_project`.",
  access: { risk: "destructive" },
  input: z.strictObject({
    integration_configuration_id: z.string(),
    integration_product_id_or_slug: z.string(),
    name: z.string(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    externalId: z.string().optional(),
  }),
  execute: async ({
    integration_configuration_id,
    integration_product_id_or_slug,
    name,
    metadata,
    externalId,
  }) => {
    const result = await vercel().integrations.createIntegrationStoreDirect({
      ...TEAM,
      requestBody: {
        name,
        integrationConfigurationId: integration_configuration_id,
        integrationProductIdOrSlug: integration_product_id_or_slug,
        metadata,
        externalId,
      },
    });
    return JSON.stringify(result);
  },
});
