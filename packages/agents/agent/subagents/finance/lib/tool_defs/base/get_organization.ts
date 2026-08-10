import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import { hcbOrganizationSchema, type HcbOrganization } from "../../constants.ts";

export const get_organization = defineTool({
  description:
    "Get the Hack Club Bank organization profile — name, slug, website, description, and whether Transparency Mode is enabled. Amounts are in cents.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const data: HcbOrganization = await hcbGet(
      `/organizations/${hcbOrgSlug()}`,
      undefined,
      hcbOrganizationSchema,
    );
    return {
      id: data.id,
      name: data.name,
      slug: data.slug,
      category: data.category,
      transparent: data.transparent,
      website: data.website,
      description: data.description,
      balance_cents: data.balances?.balance_cents,
      fee_balance_cents: data.balances?.fee_balance_cents,
      incoming_balance_cents: data.balances?.incoming_balance_cents,
      total_raised_cents: data.balances?.total_raised,
    };
  },
});
