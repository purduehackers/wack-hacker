import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../client.ts";

export const get_destination_address = defineTool({
  description: "Retrieve one destination address by id.",
  access: { risk: "read" },
  input: z.strictObject({ address_id: z.string().min(1) }),
  execute: async ({ address_id }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.get(address_id, { account_id: accountId() }),
    ),
});
