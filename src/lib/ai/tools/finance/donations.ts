import { tool } from "ai";
import { z } from "zod";

import { hcbGet, hcbOrgSlug, hcbPaginate } from "./client.ts";

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
  inputSchema: z.object({
    per_page: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
    page: z.number().int().min(1).optional().describe("Page number (default 1)"),
  }),
  execute: async ({ per_page, page }) => {
    const data = await hcbGet<HcbDonation[]>(`/organizations/${hcbOrgSlug()}/donations`, {
      per_page: per_page ?? 50,
      page: page ?? 1,
    });
    return JSON.stringify(data.map(projectDonation));
  },
});

/** Sum donations in a date window. */
export const donation_totals = tool({
  description:
    "Sum successful donations within an ISO date range. Returns total_cents, count, and a breakdown of recurring vs one-time. Useful for fundraising team asks ('what did we raise this month?').",
  inputSchema: z.object({
    since: z.string().optional().describe("ISO date — include donations on/after this date"),
    until: z.string().optional().describe("ISO date — include donations on/before this date"),
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
      if (
        d.status &&
        d.status !== "deposited" &&
        d.status !== "succeeded" &&
        d.status !== "in_transit"
      )
        continue;
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
