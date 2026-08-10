import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbOrgSlug, hcbPaginate } from "../../client.ts";
import { hcbDonationSchema } from "../../constants.ts";

/** Anything else — refunded, failed, pending — is not money the org has raised. */
const SETTLED_DONATION_STATUSES = new Set(["deposited", "succeeded", "in_transit"]);

export const donation_totals = defineTool({
  description:
    "Sum successful donations within an ISO date range. Returns total_cents, count, and a breakdown of recurring vs one-time. Useful for fundraising team asks ('what did we raise this month?').",
  access: { risk: "read" },
  input: z.strictObject({
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
    for (const donation of all) {
      const normalizedStatus = donation.status?.toLowerCase();
      if (!normalizedStatus || !SETTLED_DONATION_STATUSES.has(normalizedStatus)) continue;
      const created = donation.created_at;
      if (sinceTs !== undefined && created && Date.parse(created) < sinceTs) continue;
      if (untilTs !== undefined && created && Date.parse(created) > untilTs) continue;
      total += donation.amount_cents ?? 0;
      count += 1;
      if (donation.recurring) recurring += donation.amount_cents ?? 0;
      else oneTime += donation.amount_cents ?? 0;
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
