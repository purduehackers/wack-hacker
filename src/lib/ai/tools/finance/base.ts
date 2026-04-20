import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug } from "./client.ts";

interface HcbOrganization {
  id?: string;
  name?: string;
  slug?: string;
  category?: string;
  transparent?: boolean;
  website?: string;
  description?: string;
  balances?: {
    balance_cents?: number;
    fee_balance_cents?: number;
    incoming_balance_cents?: number;
    total_raised?: number;
  };
}

/** Get the Purdue Hackers HCB organization profile. */
export const get_organization = tool({
  description:
    "Get the Hack Club Bank organization profile — name, slug, website, description, and whether Transparency Mode is enabled. Amounts are in cents.",
  inputSchema: z.object({}),
  execute: async () => {
    const data = await hcbGet<HcbOrganization>(`/organizations/${hcbOrgSlug()}`);
    return JSON.stringify({
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
    });
  },
});

/** Get the current HCB account balance summary. */
export const get_balance = tool({
  description:
    "Get the current Hack Club Bank balance summary for Purdue Hackers — cleared balance, incoming (pending) balance, fee balance, and total raised. All amounts in cents (negative = outflow).",
  inputSchema: z.object({}),
  execute: async () => {
    const data = await hcbGet<HcbOrganization>(`/organizations/${hcbOrgSlug()}`);
    const b = data.balances ?? {};
    return JSON.stringify({
      balance_cents: b.balance_cents,
      fee_balance_cents: b.fee_balance_cents,
      incoming_balance_cents: b.incoming_balance_cents,
      total_raised_cents: b.total_raised,
    });
  },
});
