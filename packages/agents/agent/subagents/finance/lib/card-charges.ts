import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const hcbCardChargeSchema = z.object({
  id: z.string().optional(),
  amount_cents: z.number().optional(),
  memo: z.string().optional(),
  spent_at: z.string().optional(),
  pending: z.boolean().optional(),
  user: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  card: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      last4: z.string().optional(),
    })
    .optional(),
  merchant: z.object({ name: z.string().optional() }).optional(),
  receipts: z.object({ count: z.number().optional(), missing: z.boolean().optional() }).optional(),
  transaction_id: z.string().optional(),
});
type HcbCardCharge = z.infer<typeof hcbCardChargeSchema>;

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
export const list_card_charges = defineTool({
  description:
    "List HCB card charges — merchant, user, amount_cents, and receipts summary {count, missing}. Supports an optional user filter (substring match on cardholder name or email) for microgrant recipient spend tracking.",
  access: { risk: "read" },
  input: z.object({
    user: z
      .string()
      .optional()
      .describe("Substring match (case-insensitive) against cardholder name or email"),
    ...paginationInputShape,
  }),
  execute: async ({ user, ...pagination }) => {
    const path = `/organizations/${hcbOrgSlug()}/card_charges`;
    if (user) {
      const all = await hcbPaginate(
        path,
        {},
        {
          maxItems: 500,
          maxPages: 10,
          perPage: 100,
        },
        hcbCardChargeSchema,
      );
      const needle = user.toLowerCase();
      const matches = all.filter(
        (c) =>
          (c.user?.name ?? "").toLowerCase().includes(needle) ||
          (c.user?.email ?? "").toLowerCase().includes(needle),
      );
      return matches.map(projectCharge);
    }
    const data = await hcbGet(path, paginationQuery(pagination), z.array(hcbCardChargeSchema));
    return data.map(projectCharge);
  },
});
