import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug } from "./client.ts";

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
  inputSchema: z.object({
    per_page: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
  }),
  execute: async ({ per_page, page }) => {
    const data = await hcbGet<HcbTransfer[]>(`/organizations/${hcbOrgSlug()}/transfers`, {
      per_page: per_page ?? 50,
      page: page ?? 1,
    });
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
