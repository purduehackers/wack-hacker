import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

interface HcbTransfer {
  id?: string;
  amount_cents?: number;
  memo?: string;
  status?: string;
  created_at?: string;
  sender?: { id?: string; name?: string; slug?: string };
  receiver?: { id?: string; name?: string; slug?: string };
}

/** List inter-org transfers (disbursements between HCB orgs). */
export const list_transfers = tool({
  description:
    "List HCB inter-org transfers (disbursements) involving Purdue Hackers — sender, receiver, amount_cents, status, and memo.",
  inputSchema: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet<HcbTransfer[]>(
      `/organizations/${hcbOrgSlug()}/transfers`,
      paginationQuery(input),
    );
    return JSON.stringify(
      data.map((t) => ({
        id: t.id,
        amount_cents: t.amount_cents,
        memo: t.memo,
        status: t.status,
        created_at: t.created_at,
        sender: t.sender?.name ?? t.sender?.slug,
        receiver: t.receiver?.name ?? t.receiver?.slug,
      })),
    );
  },
});
