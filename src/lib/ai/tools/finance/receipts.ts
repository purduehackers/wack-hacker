import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl } from "./client.ts";

interface HcbTransaction {
  id?: string;
  date?: string;
  amount_cents?: number;
  memo?: string;
  type?: string;
  pending?: boolean;
  receipts?: { count?: number; missing?: boolean };
}

/**
 * List transactions flagged as missing a receipt.
 *
 * IMPORTANT: the HCB public API v3 does not expose receipt files/URLs. This
 * tool can only report whether a receipt is attached (via the
 * `receipts: { count, missing }` summary on each transaction). Uploading or
 * viewing actual receipt files still requires the HCB web UI.
 */
export const list_missing_receipts = tool({
  description:
    "List HCB transactions flagged as missing a receipt. Note: only HCB card charges and HCB reimbursements are tracked here — org-wide reimbursements through Purdue's BOSO portal are NOT in HCB. The HCB API does not expose receipt files themselves — only whether one is attached. Link users to hcb.hackclub.com/hcb/{id} to upload/view files.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(200).optional().describe("Max results (default 50)"),
  }),
  execute: async ({ limit }) => {
    const all = await hcbPaginate<HcbTransaction>(
      `/organizations/${hcbOrgSlug()}/transactions`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
    );
    const missing = all.filter((t) => Boolean(t.receipts?.missing));
    return JSON.stringify(
      missing.slice(0, limit ?? 50).map((t) => ({
        id: t.id,
        date: t.date,
        amount_cents: t.amount_cents,
        memo: t.memo,
        type: t.type,
        pending: t.pending,
        receipts: t.receipts,
        href: t.id ? hcbTxnUrl(t.id) : undefined,
      })),
    );
  },
});

/** Report whether a given transaction has a receipt attached. */
export const get_receipt_status = tool({
  description:
    "Report whether a given HCB transaction has a receipt attached — returns { id, receipts: { count, missing }, href }. The HCB API does not expose the receipt file itself; to upload or view the actual image/PDF, visit hcb.hackclub.com/hcb/{id}.",
  inputSchema: z.object({
    id: z.string().describe("HCB transaction id"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet<HcbTransaction>(`/transactions/${id}`);
    return JSON.stringify({
      id,
      receipts: {
        count: data.receipts?.count ?? 0,
        missing: data.receipts?.missing ?? false,
      },
      href: hcbTxnUrl(id),
    });
  },
});
