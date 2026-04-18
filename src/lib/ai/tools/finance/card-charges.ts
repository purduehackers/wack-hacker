import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl } from "./client.ts";

interface HcbCardCharge {
  id?: string;
  amount_cents?: number;
  memo?: string;
  spent_at?: string;
  pending?: boolean;
  user?: { id?: string; name?: string; email?: string };
  card?: { id?: string; name?: string; last4?: string };
  merchant?: { name?: string };
  receipts?: { count?: number; missing?: boolean };
  transaction_id?: string;
}

function projectCharge(c: HcbCardCharge) {
  return {
    id: c.id,
    amount_cents: c.amount_cents,
    memo: c.memo,
    spent_at: c.spent_at,
    pending: c.pending,
    user: c.user?.name,
    user_email: c.user?.email,
    card_last4: c.card?.last4,
    merchant: c.merchant?.name,
    receipts: c.receipts,
    href: c.transaction_id ? hcbTxnUrl(c.transaction_id) : undefined,
  };
}

/** List HCB card charges, optionally filtered by user. */
export const list_card_charges = tool({
  description:
    "List HCB card charges — merchant, user, amount_cents, and receipts summary {count, missing}. Supports an optional user filter (substring match on cardholder name or email) for microgrant recipient spend tracking.",
  inputSchema: z.object({
    user: z
      .string()
      .optional()
      .describe("Substring match (case-insensitive) against cardholder name or email"),
    per_page: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
  }),
  execute: async ({ user, per_page, page }) => {
    if (user) {
      const all = await hcbPaginate<HcbCardCharge>(
        `/organizations/${hcbOrgSlug()}/card_charges`,
        {},
        { maxItems: 500, maxPages: 10, perPage: 100 },
      );
      const needle = user.toLowerCase();
      const filtered = all.filter(
        (c) =>
          (c.user?.name ?? "").toLowerCase().includes(needle) ||
          (c.user?.email ?? "").toLowerCase().includes(needle),
      );
      return JSON.stringify(filtered.map(projectCharge));
    }
    const data = await hcbGet<HcbCardCharge[]>(`/organizations/${hcbOrgSlug()}/card_charges`, {
      per_page: per_page ?? 50,
      page: page ?? 1,
    });
    return JSON.stringify(data.map(projectCharge));
  },
});
