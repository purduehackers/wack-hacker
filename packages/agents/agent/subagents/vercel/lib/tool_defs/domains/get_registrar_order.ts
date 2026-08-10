import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_registrar_order = defineTool({
  description: "Retrieve a registrar order (from buy/transfer/renew) by its id.",
  access: { risk: "read" },
  input: z.strictObject({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    const result = await vercel().domainsRegistrar.getOrder({ ...TEAM, orderId });
    return JSON.stringify(result);
  },
});
