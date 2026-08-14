import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import { hcbInvoiceSchema, paginationInputShape } from "../../constants.ts";
import { paginationQuery, projectInvoice } from "../../projections.ts";

export const list_invoices = defineTool({
  description:
    "List invoices sent by the org — sponsor name, amount_cents, status (open/paid/void), due/paid dates, and memo.",
  access: { risk: "read" },
  input: z.strictObject(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/invoices`,
      paginationQuery(input),
      z.array(hcbInvoiceSchema),
    );
    return data.map(projectInvoice);
  },
});
