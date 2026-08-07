import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug, hcbPaginate, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";

const SETTLED_DONATION_STATUSES = new Set(["deposited", "succeeded", "in_transit"]);

const hcbDonationSchema = z.object({
  id: z.string().optional(),
  amount_cents: z.number().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  status: z.string().optional(),
  recurring: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  created_at: z.string().optional(),
  message: z.string().optional(),
});
type HcbDonation = z.infer<typeof hcbDonationSchema>;

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
export const list_donations = defineTool({
  description:
    "List donations to the Hack Club Bank org — donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  access: { risk: "read" },
  input: z.object(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/donations`,
      paginationQuery(input),
      z.array(hcbDonationSchema),
    );
    return data.map(projectDonation);
  },
});

/** Fetch a single donation by ID. */
export const get_donation = defineTool({
  description:
    "Fetch a single donation by ID. Returns donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  access: { risk: "read" },
  input: z.object({
    id: z.string().describe("Donation ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/donations/${id}`, undefined, hcbDonationSchema);
    return projectDonation(data);
  },
});

/** Sum donations in a date window. */
export const donation_totals = defineTool({
  description:
    "Sum successful donations within an ISO date range. Returns total_cents, count, and a breakdown of recurring vs one-time. Useful for fundraising team asks ('what did we raise this month?').",
  access: { risk: "read" },
  input: z.object({
    since: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/after this date"),
    until: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/before this date"),
  }),
  execute: async ({ since, until }) => {
    const all = await hcbPaginate(
      `/organizations/${hcbOrgSlug()}/donations`,
      {},
      { maxItems: 1000, maxPages: 20, perPage: 100 },
      hcbDonationSchema,
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
    return {
      since,
      until,
      total_cents: total,
      count,
      recurring_cents: recurring,
      one_time_cents: oneTime,
    };
  },
});
