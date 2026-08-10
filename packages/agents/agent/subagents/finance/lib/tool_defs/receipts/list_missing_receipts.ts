import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbOrgSlug, hcbPaginate } from "../../client.ts";
import { hcbTransactionSchema, projectTransaction, type HcbTransaction } from "../../constants.ts";

/**
 * List transactions flagged as missing a receipt.
 *
 * IMPORTANT: the HCB public API v3 does not expose receipt files/URLs. This
 * tool can only report whether a receipt is attached (via the
 * `receipts: { count, missing }` summary on each transaction). Uploading or
 * viewing actual receipt files still requires the HCB web UI.
 */
export const list_missing_receipts = defineTool({
  description:
    "List HCB transactions flagged as missing a receipt. Note: only HCB card charges and HCB reimbursements are tracked here — org-wide reimbursements through Purdue's BOSO portal are NOT in HCB. The HCB API does not expose receipt files themselves — only whether one is attached. Link users to hcb.hackclub.com/hcb/{id} to upload/view files.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: z.int().min(1).max(200).optional().describe("Max results (default 50)"),
  }),
  execute: async ({ limit }) => {
    const all: HcbTransaction[] = await hcbPaginate(
      `/organizations/${hcbOrgSlug()}/transactions`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
      hcbTransactionSchema,
    );
    const missing = all.filter((entry) => Boolean(entry.receipts?.missing));
    return missing.slice(0, limit ?? 50).map(projectTransaction);
  },
});
