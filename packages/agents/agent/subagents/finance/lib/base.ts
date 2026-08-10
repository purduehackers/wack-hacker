import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "./client.ts";

const hcbOrganizationSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  category: z.string().optional(),
  transparent: z.boolean().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
  balances: z
    .object({
      balance_cents: z.number().optional(),
      fee_balance_cents: z.number().optional(),
      incoming_balance_cents: z.number().optional(),
      total_raised: z.number().optional(),
    })
    .optional(),
});
type HcbOrganization = z.output<typeof hcbOrganizationSchema>;

/** Get the Purdue Hackers HCB organization profile. */
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

/** Get the current HCB account balance summary. */
export const get_balance = defineTool({
  description:
    "Get the current Hack Club Bank balance summary for Purdue Hackers — cleared balance, incoming (pending) balance, fee balance, and total raised. All amounts in cents (negative = outflow).",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const data: HcbOrganization = await hcbGet(
      `/organizations/${hcbOrgSlug()}`,
      undefined,
      hcbOrganizationSchema,
    );
    const b = data.balances ?? {};
    return {
      balance_cents: b.balance_cents,
      fee_balance_cents: b.fee_balance_cents,
      incoming_balance_cents: b.incoming_balance_cents,
      total_raised_cents: b.total_raised,
    };
  },
});
