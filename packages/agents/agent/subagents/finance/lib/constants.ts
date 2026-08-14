/**
 * @fileoverview Input shapes and parse schemas shared across this domain's
 * tools.
 *
 * HCB's v3 API returns wide records where almost every field is optional. A
 * tool that forwarded them verbatim would spend most of its output budget on
 * keys no one asked about. Each resource therefore gets one parse schema here
 * and one projection in `./projections.ts`, so `list_*` and `get_*` cannot
 * drift into describing the same record differently.
 */

import { z } from "zod";

export const paginationInputShape = {
  per_page: z.int().min(1).max(100).optional().describe("Page size (default 50)"),
  page: z.int().min(1).optional().describe("Page number (default 1)"),
};

export const hcbOrganizationSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  category: z.string().optional(),
  transparent: z.boolean().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
  balances: z
    .object({
      balance_cents: z.number().optional(),
      fee_balance_cents: z.number().optional(),
      incoming_balance_cents: z.number().optional(),
      total_raised: z.number().optional(),
    })
    .optional(),
});

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

export const hcbDonationSchema = z.object({
  id: z.string().optional(),
  amount_cents: z.number().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  recurring: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  created_at: z.string().optional(),
  message: z.string().optional(),
});

export const hcbInvoiceSchema = z.object({
  id: z.string().optional(),
  amount_cents: z.number().optional(),
  sponsor: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  status: z.string().optional(),
  due_date: z.string().optional(),
  memo: z.string().optional(),
  created_at: z.string().optional(),
  paid_at: z.string().optional(),
});

export const hcbTransferSchema = z.object({
  id: z.string().optional(),
  amount_cents: z.number().optional(),
  memo: z.string().optional(),
  status: z.string().optional(),
  created_at: z.string().optional(),
  sender: z
    .object({ id: z.string().optional(), name: z.string().optional(), slug: z.string().optional() })
    .optional(),
  receiver: z
    .object({ id: z.string().optional(), name: z.string().optional(), slug: z.string().optional() })
    .optional(),
});
