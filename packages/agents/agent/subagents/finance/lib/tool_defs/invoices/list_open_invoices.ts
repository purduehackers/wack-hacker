import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbOrgSlug, hcbPaginate } from "../../client.ts";
import { hcbInvoiceSchema } from "../../constants.ts";
import { projectInvoice } from "../../projections.ts";

/** HCB has no `open` status. An invoice is open until it reaches one of these. */
const CLOSED_INVOICE_STATUSES = new Set(["paid", "void", "voided", "deposited"]);

export const list_open_invoices = defineTool({
  description:
    "List outstanding (unpaid) invoices only — drives fundraising follow-ups with sponsors. Paginates through all invoices and filters to statuses that aren't paid/void.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const all = await hcbPaginate(
      `/organizations/${hcbOrgSlug()}/invoices`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
      hcbInvoiceSchema,
    );
    const open = all.filter(
      (invoice) => !CLOSED_INVOICE_STATUSES.has((invoice.status ?? "").toLowerCase()),
    );
    return open.map(projectInvoice);
  },
});
