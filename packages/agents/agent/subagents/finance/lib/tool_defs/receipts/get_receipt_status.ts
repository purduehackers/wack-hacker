import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbTxnUrl } from "../../client.ts";
import { hcbTransactionSchema, type HcbTransaction } from "../../constants.ts";

export const get_receipt_status = defineTool({
  description:
    "Report whether a given HCB transaction has a receipt attached — returns { id, receipts: { count, missing }, href }. The HCB API does not expose the receipt file itself; to upload or view the actual image/PDF, visit hcb.hackclub.com/hcb/{id}.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("HCB transaction id"),
  }),
  execute: async ({ id }) => {
    const data: HcbTransaction = await hcbGet(
      `/transactions/${id}`,
      undefined,
      hcbTransactionSchema,
    );
    return {
      id,
      receipts: {
        count: data.receipts?.count ?? 0,
        missing: data.receipts?.missing ?? false,
      },
      href: hcbTxnUrl(id),
    };
  },
});
