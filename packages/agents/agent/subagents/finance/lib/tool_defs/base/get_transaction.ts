import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbTxnUrl } from "../../client.ts";
import { hcbTransactionSchema, projectTransaction } from "../../constants.ts";

export const get_transaction = defineTool({
  description:
    "Get a single HCB transaction by id. Returns a compact summary with id, date, amount_cents (negative = outflow), memo, type, pending flag, receipts summary {count, missing}, and href. Receipt files themselves are NOT available via HCB's API; only whether a receipt is attached — visit hcb.hackclub.com/hcb/{id} for the actual file.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("HCB transaction id (e.g. 'txn_abc123')"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/transactions/${id}`, undefined, hcbTransactionSchema);
    return { ...projectTransaction(data), href: hcbTxnUrl(id) };
  },
});
