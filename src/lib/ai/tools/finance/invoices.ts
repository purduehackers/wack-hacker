import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const CLOSED_INVOICE_STATUSES = new Set(["paid", "void", "voided", "deposited"]);

interface HcbInvoice {
  id?: string;
  amount_cents?: number;
  sponsor?: { id?: string; name?: string; email?: string };
  status?: string;
  due_date?: string;
  memo?: string;
  created_at?: string;
  paid_at?: string;
}

function projectInvoice(i: HcbInvoice) {
  return {
    id: i.id,
    amount_cents: i.amount_cents,
    sponsor: i.sponsor?.name,
    sponsor_email: i.sponsor?.email,
    status: i.status,
    due_date: i.due_date,
    paid_at: i.paid_at,
    memo: i.memo,
    created_at: i.created_at,
  };
}

/** List all invoices. */
export const list_invoices = tool({
  description:
    "List invoices sent by the org — sponsor name, amount_cents, status (open/paid/void), due/paid dates, and memo.",
  inputSchema: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet<HcbInvoice[]>(
      `/organizations/${hcbOrgSlug()}/invoices`,
      paginationQuery(input),
    );
    return JSON.stringify(data.map(projectInvoice));
  },
});

/** List outstanding (unpaid) invoices. */
export const list_open_invoices = tool({
  description:
    "List outstanding (unpaid) invoices only — drives fundraising follow-ups with sponsors. Paginates through all invoices and filters to statuses that aren't paid/void.",
  inputSchema: z.object({}),
  execute: async () => {
    const all = await hcbPaginate<HcbInvoice>(
      `/organizations/${hcbOrgSlug()}/invoices`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
    );
    const open = all.filter((i) => !CLOSED_INVOICE_STATUSES.has((i.status ?? "").toLowerCase()));
    return JSON.stringify(open.map(projectInvoice));
  },
});
