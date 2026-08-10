import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import {
  hcbTransactionSchema,
  paginationInputShape,
  paginationQuery,
  projectTransaction,
} from "../../constants.ts";

export const list_transactions = defineTool({
  description:
    "List recent HCB transactions for Purdue Hackers — newest first. Each transaction includes id, date, amount_cents (negative = outflow), memo, type, pending flag, and a receipts summary {count, missing}. Receipt files themselves are NOT available via HCB's API; only whether a receipt is attached.",
  access: { risk: "read" },
  input: z.strictObject(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/transactions`,
      paginationQuery(input),
      z.array(hcbTransactionSchema),
    );
    return data.map(projectTransaction);
  },
});
