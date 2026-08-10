import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet } from "../../client.ts";
import { hcbTransferSchema, projectTransfer } from "../../constants.ts";

export const get_transfer = defineTool({
  description:
    "Get a single HCB inter-org transfer by ID — sender, receiver, amount_cents, status, and memo.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("Transfer ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/transfers/${id}`, undefined, hcbTransferSchema);
    return projectTransfer(data);
  },
});
