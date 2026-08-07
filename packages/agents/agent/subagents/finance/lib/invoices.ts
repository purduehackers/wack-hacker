import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

const CLOSED_INVOICE_STATUSES = new Set(["paid", "void", "voided", "deposited"]);

const hcbInvoiceSchema = z.object({
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
type HcbInvoice = z.infer<typeof hcbInvoiceSchema>;

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
export const list_invoices = defineTool({
  name: "list_invoices",
  domain: "finance",
  description:
    "List invoices sent by the org — sponsor name, amount_cents, status (open/paid/void), due/paid dates, and memo.",
  access: { risk: "read" },
  input: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/invoices`,
      paginationQuery(input),
      z.array(hcbInvoiceSchema),
    );
    return data.map(projectInvoice);
  },
});

/** Get a single invoice by ID. */
export const get_invoice = defineTool({
  name: "get_invoice",
  domain: "finance",
  description:
    "Get a single invoice by ID — sponsor name, amount_cents, status, due/paid dates, and memo.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("Invoice ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/invoices/${id}`, undefined, hcbInvoiceSchema);
    return projectInvoice(data);
  },
});

/** List outstanding (unpaid) invoices. */
export const list_open_invoices = defineTool({
  name: "list_open_invoices",
  domain: "finance",
  description:
    "List outstanding (unpaid) invoices only — drives fundraising follow-ups with sponsors. Paginates through all invoices and filters to statuses that aren't paid/void.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const all = await hcbPaginate(
      `/organizations/${hcbOrgSlug()}/invoices`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
      hcbInvoiceSchema,
    );
    const open = all.filter((i) => !CLOSED_INVOICE_STATUSES.has((i.status ?? "").toLowerCase()));
    return open.map(projectInvoice);
  },
});
