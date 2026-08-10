import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl } from "../../client.ts";
import { paginationInputShape, paginationQuery } from "../../constants.ts";

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
type HcbCardCharge = z.output<typeof hcbCardChargeSchema>;

function projectCharge(charge: HcbCardCharge) {
  return {
    id: charge.id,
    amount_cents: charge.amount_cents,
    memo: charge.memo,
    spent_at: charge.spent_at,
    pending: charge.pending,
    user: charge.user?.name,
    user_email: charge.user?.email,
    card_last4: charge.card?.last4,
    merchant: charge.merchant?.name,
    receipts: charge.receipts,
    href: charge.transaction_id ? hcbTxnUrl(charge.transaction_id) : undefined,
  };
}

export const list_card_charges = defineTool({
  description:
    "List HCB card charges — merchant, user, amount_cents, and receipts summary {count, missing}. Supports an optional user filter (substring match on cardholder name or email) for microgrant recipient spend tracking.",
  access: { risk: "read" },
  input: z.strictObject({
    user: z
      .string()
      .optional()
      .describe("Substring match (case-insensitive) against cardholder name or email"),
    ...paginationInputShape,
  }),
  execute: async ({ user, ...pagination }) => {
    const path = `/organizations/${hcbOrgSlug()}/card_charges`;
    // HCB has no server-side cardholder filter, so a user query has to page the
    // charge list and match locally.
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
        (charge) =>
          (charge.user?.name ?? "").toLowerCase().includes(needle) ||
          (charge.user?.email ?? "").toLowerCase().includes(needle),
      );
      return matches.map(projectCharge);
    }
    const data = await hcbGet(path, paginationQuery(pagination), z.array(hcbCardChargeSchema));
    return data.map(projectCharge);
  },
});
