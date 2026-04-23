import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const SETTLED_DONATION_STATUSES = new Set(["deposited", "succeeded", "in_transit"]);

interface HcbDonation {
  id?: string;
  amount_cents?: number;
  name?: string;
  email?: string;
  status?: string;
  recurring?: boolean;
  anonymous?: boolean;
  created_at?: string;
  message?: string;
}

function projectDonation(d: HcbDonation) {
  return {
    id: d.id,
    amount_cents: d.amount_cents,
    donor: d.anonymous ? "(anonymous)" : d.name,
    email: d.anonymous ? undefined : d.email,
    status: d.status,
    recurring: d.recurring,
    created_at: d.created_at,
    message: d.message,
  };
}

/** List donations to the org. */
export const list_donations = tool({
  description:
    "List donations to the Hack Club Bank org — donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  inputSchema: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet<HcbDonation[]>(
      `/organizations/${hcbOrgSlug()}/donations`,
      paginationQuery(input),
    );
    return JSON.stringify(data.map(projectDonation));
  },
});

/** Fetch a single donation by ID. */
export const get_donation = tool({
  description:
    "Fetch a single donation by ID. Returns donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  inputSchema: z.object({
    id: z.string().describe("Donation ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet<HcbDonation>(`/donations/${id}`);
    return JSON.stringify(projectDonation(data));
  },
});

/** Sum donations in a date window. */
export const donation_totals = tool({
  description:
    "Sum successful donations within an ISO date range. Returns total_cents, count, and a breakdown of recurring vs one-time. Useful for fundraising team asks ('what did we raise this month?').",
  inputSchema: z.object({
    since: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/after this date"),
    until: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/before this date"),
  }),
  execute: async ({ since, until }) => {
    const all = await hcbPaginate<HcbDonation>(
      `/organizations/${hcbOrgSlug()}/donations`,
      {},
      { maxItems: 1000, maxPages: 20, perPage: 100 },
    );
    const sinceTs = since ? Date.parse(since) : undefined;
    const untilTs = until ? Date.parse(until) : undefined;
    let total = 0;
    let recurring = 0;
    let oneTime = 0;
    let count = 0;
    for (const d of all) {
      const normalizedStatus = d.status?.toLowerCase();
      if (!normalizedStatus || !SETTLED_DONATION_STATUSES.has(normalizedStatus)) continue;
      if (sinceTs !== undefined && d.created_at && Date.parse(d.created_at) < sinceTs) continue;
      if (untilTs !== undefined && d.created_at && Date.parse(d.created_at) > untilTs) continue;
      total += d.amount_cents ?? 0;
      count += 1;
      if (d.recurring) recurring += d.amount_cents ?? 0;
      else oneTime += d.amount_cents ?? 0;
    }
    return JSON.stringify({
      since,
      until,
      total_cents: total,
      count,
      recurring_cents: recurring,
      one_time_cents: oneTime,
    });
  },
});
