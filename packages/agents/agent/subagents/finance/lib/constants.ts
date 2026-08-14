/**
 * @fileoverview Input shapes and response projections shared across this
 * domain's tools.
 *
 * HCB's v3 API returns wide records where almost every field is optional. A
 * tool that forwarded them verbatim would spend most of its output budget on
 * keys no one asked about. Each resource therefore gets one parse schema and
 * one projection, declared here so that `list_*` and `get_*` cannot drift into
 * describing the same record differently.
 */

import { z } from "zod";

import { hcbTxnUrl } from "./client.ts";

export const paginationInputShape = {
  per_page: z.int().min(1).max(100).optional().describe("Page size (default 50)"),
  page: z.int().min(1).optional().describe("Page number (default 1)"),
};

const paginationInputSchema = z.object(paginationInputShape);

/** Resolve pagination input to a query-string object with defaults. */
export function paginationQuery(input: z.input<typeof paginationInputSchema>) {
  return { per_page: input.per_page ?? 50, page: input.page ?? 1 };
}

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
export type HcbOrganization = z.output<typeof hcbOrganizationSchema>;

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
export function projectTransaction(entry: HcbTransaction) {
  return {
    id: entry.id,
    date: entry.date,
    amount_cents: entry.amount_cents,
    memo: entry.memo,
    type: entry.type,
    pending: entry.pending,
    receipts: entry.receipts,
    href: entry.id ? hcbTxnUrl(entry.id) : undefined,
  };
}

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
export type HcbDonation = z.output<typeof hcbDonationSchema>;

/** An anonymous donation must not leak the donor's name or address. */
export function projectDonation(entry: HcbDonation) {
  return {
    id: entry.id,
    amount_cents: entry.amount_cents,
    donor: entry.anonymous ? "(anonymous)" : entry.name,
    email: entry.anonymous ? undefined : entry.email,
    status: entry.status,
    recurring: entry.recurring,
    created_at: entry.created_at,
    message: entry.message,
  };
}

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
export type HcbInvoice = z.output<typeof hcbInvoiceSchema>;

/** Sponsor contact fields flatten to name and email so the output stays one level deep. */
export function projectInvoice(entry: HcbInvoice) {
  return {
    id: entry.id,
    amount_cents: entry.amount_cents,
    sponsor: entry.sponsor?.name,
    sponsor_email: entry.sponsor?.email,
    status: entry.status,
    due_date: entry.due_date,
    paid_at: entry.paid_at,
    memo: entry.memo,
    created_at: entry.created_at,
  };
}

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
export type HcbTransfer = z.output<typeof hcbTransferSchema>;

/** Either side of a transfer may be an org HCB names only by slug. */
export function projectTransfer(entry: HcbTransfer) {
  return {
    id: entry.id,
    amount_cents: entry.amount_cents,
    memo: entry.memo,
    status: entry.status,
    created_at: entry.created_at,
    sender: entry.sender?.name ?? entry.sender?.slug,
    receiver: entry.receiver?.name ?? entry.receiver?.slug,
  };
}
