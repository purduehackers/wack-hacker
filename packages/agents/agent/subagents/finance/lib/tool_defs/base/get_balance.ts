import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import { hcbOrganizationSchema } from "../../constants.ts";
import type { HcbOrganization } from "../../projections.ts";

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
    const balances = data.balances ?? {};
    return {
      balance_cents: balances.balance_cents,
      fee_balance_cents: balances.fee_balance_cents,
      incoming_balance_cents: balances.incoming_balance_cents,
      total_raised_cents: balances.total_raised,
    };
  },
});
