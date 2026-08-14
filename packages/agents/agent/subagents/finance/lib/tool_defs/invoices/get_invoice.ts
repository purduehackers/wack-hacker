import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet } from "../../client.ts";
import { hcbInvoiceSchema } from "../../constants.ts";
import { projectInvoice } from "../../projections.ts";

export const get_invoice = defineTool({
  description:
    "Get a single invoice by ID — sponsor name, amount_cents, status, due/paid dates, and memo.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("Invoice ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/invoices/${id}`, undefined, hcbInvoiceSchema);
    return projectInvoice(data);
  },
});
