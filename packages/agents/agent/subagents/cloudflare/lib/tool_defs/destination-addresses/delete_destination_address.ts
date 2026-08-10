import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../client.ts";

export const delete_destination_address = defineTool({
  description:
    "Remove a destination address from the account. Any routing rule still forwarding to it stops delivering.",
  access: { risk: "destructive", confirm: "second-party" },
  input: z.strictObject({ address_id: z.string().min(1) }),
  execute: async ({ address_id }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.delete(address_id, { account_id: accountId() }),
    ),
});
