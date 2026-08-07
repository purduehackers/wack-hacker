import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const hcbTransferSchema = z.object({
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
type HcbTransfer = z.infer<typeof hcbTransferSchema>;

function projectTransfer(t: HcbTransfer) {
  return {
    id: t.id,
    amount_cents: t.amount_cents,
    memo: t.memo,
    status: t.status,
    created_at: t.created_at,
    sender: t.sender?.name ?? t.sender?.slug,
    receiver: t.receiver?.name ?? t.receiver?.slug,
  };
}

/** Get a single inter-org transfer by ID. */
export const get_transfer = defineTool({
  description:
    "Get a single HCB inter-org transfer by ID — sender, receiver, amount_cents, status, and memo.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("Transfer ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/transfers/${id}`, undefined, hcbTransferSchema);
    return projectTransfer(data);
  },
});

/** List inter-org transfers (disbursements between HCB orgs). */
export const list_transfers = defineTool({
  description:
    "List HCB inter-org transfers (disbursements) involving Purdue Hackers — sender, receiver, amount_cents, status, and memo.",
  access: { risk: "read" },
  input: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/transfers`,
      paginationQuery(input),
      z.array(hcbTransferSchema),
    );
    return data.map(projectTransfer);
  },
});
