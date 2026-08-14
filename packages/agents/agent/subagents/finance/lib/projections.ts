/**
 * @fileoverview Response projections and pagination resolution shared across
 * this domain's tools.
 *
 * Each projection pairs with one parse schema from `./constants.ts`, so
 * `list_*` and `get_*` cannot drift into describing the same record
 * differently.
 */

import { z } from "zod";

import { hcbTxnUrl } from "./client.ts";
import {
  type hcbDonationSchema,
  type hcbInvoiceSchema,
  type hcbOrganizationSchema,
  type hcbTransactionSchema,
  type hcbTransferSchema,
  paginationInputShape,
} from "./constants.ts";

const paginationInputSchema = z.object(paginationInputShape);

/** Resolve pagination input to a query-string object with defaults. */
export function paginationQuery(input: z.input<typeof paginationInputSchema>) {
  return { per_page: input.per_page ?? 50, page: input.page ?? 1 };
}

export type HcbOrganization = z.output<typeof hcbOrganizationSchema>;

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
