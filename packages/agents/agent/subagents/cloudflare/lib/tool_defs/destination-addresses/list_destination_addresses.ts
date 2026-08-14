import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../client.ts";

export const list_destination_addresses = defineTool({
  description:
    "List the account's Email Routing destination addresses and whether each one is verified. Only verified addresses can receive forwarded mail.",
  access: { risk: "read" },
  input: z.strictObject({
    verified_only: z.boolean().default(false),
  }),
  execute: async ({ verified_only }) => {
    const page = await cloudflare().emailRouting.addresses.list({
      account_id: accountId(),
      ...(verified_only && { verified: true }),
    });
    return JSON.stringify(page.result);
  },
});
