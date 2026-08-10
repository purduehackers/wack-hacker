import { z } from "zod";

import { hcbTxnUrl } from "./client.ts";

const hcbReceiptsSummarySchema = z.object({
  count: z.number().optional(),
  missing: z.boolean().optional(),
});
export const hcbTransactionSchema = z.object({
  id: z.string().optional(),
  date: z.string().optional(),
  amount_cents: z.number().optional(),
  memo: z.string().optional(),
  type: z.string().optional(),
  pending: z.boolean().optional(),
  receipts: hcbReceiptsSummarySchema.optional(),
});
export type HcbTransaction = z.output<typeof hcbTransactionSchema>;

/** Compact projection shared by every tool that returns an HCB transaction. */
export function projectTransaction(t: HcbTransaction) {
  return {
    id: t.id,
    date: t.date,
    amount_cents: t.amount_cents,
    memo: t.memo,
    type: t.type,
    pending: t.pending,
    receipts: t.receipts,
    href: t.id ? hcbTxnUrl(t.id) : undefined,
  };
}
