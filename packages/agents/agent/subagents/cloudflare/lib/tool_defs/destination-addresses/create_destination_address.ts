import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { accountId, cloudflare } from "../../client.ts";

export const create_destination_address = defineTool({
  description:
    "Add a destination address. Cloudflare emails the owner a confirmation link and the address cannot receive forwarded mail until they click it, so tell the user to go check that inbox.",
  access: { risk: "write" },
  input: z.strictObject({ email: z.email() }),
  execute: async ({ email }) =>
    JSON.stringify(
      await cloudflare().emailRouting.addresses.create({ account_id: accountId(), email }),
    ),
});
