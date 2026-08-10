import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { isoTimestamp, TEAM } from "../../constants.ts";

export const list_billing_charges = defineTool({
  description:
    "List billing charges for the team between `from` and `to` (ISO 8601 UTC date-time strings).",
  access: { risk: "read" },
  input: z.strictObject({
    from: isoTimestamp.describe("ISO 8601 UTC date-time — inclusive start"),
    to: isoTimestamp.describe("ISO 8601 UTC date-time — exclusive end"),
  }),
  execute: async ({ from, to }) => {
    const result = await vercel().billing.listBillingCharges({ ...TEAM, from, to });
    return JSON.stringify(result);
  },
});
