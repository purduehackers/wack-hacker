import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbOrgSlug, hcbPaginate } from "../../client.ts";
import { hcbTransactionSchema, projectTransaction, type HcbTransaction } from "../../constants.ts";

const findTransactionsInput = z.strictObject({
  memo_contains: z
    .string()
    .optional()
    .describe("Case-insensitive substring match on the memo field"),
  min_amount_cents: z
    .int()
    .optional()
    .describe("Inclusive lower bound on amount_cents (signed — negatives are outflows)"),
  max_amount_cents: z.int().optional().describe("Inclusive upper bound on amount_cents"),
  since: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/after this date"),
  until: z.iso.date().optional().describe("ISO date (YYYY-MM-DD) — on/before this date"),
  pending: z
    .enum(["any", "only", "exclude"])
    .optional()
    .describe("Filter by pending status (default 'any')"),
  limit: z.int().min(1).max(200).optional().describe("Max results to return (default 50)"),
});

type FindFilter = z.output<typeof findTransactionsInput>;

/**
 * HCB's transaction endpoint takes no filters, so every criterion is applied
 * locally over a capped page walk.
 */
function buildTransactionFilter(filter: FindFilter): (entry: HcbTransaction) => boolean {
  const needle = filter.memo_contains?.toLowerCase();
  const sinceTs = filter.since ? Date.parse(filter.since) : undefined;
  const untilTs = filter.until ? Date.parse(filter.until) : undefined;
  return (entry) => {
    if (needle && !(entry.memo ?? "").toLowerCase().includes(needle)) return false;
    if (
      filter.min_amount_cents !== undefined &&
      (entry.amount_cents ?? 0) < filter.min_amount_cents
    )
      return false;
    if (
      filter.max_amount_cents !== undefined &&
      (entry.amount_cents ?? 0) > filter.max_amount_cents
    )
      return false;
    if (sinceTs !== undefined && entry.date && Date.parse(entry.date) < sinceTs) return false;
    if (untilTs !== undefined && entry.date && Date.parse(entry.date) > untilTs) return false;
    if (filter.pending === "only" && !entry.pending) return false;
    if (filter.pending === "exclude" && entry.pending) return false;
    return true;
  };
}

export const find_transactions = defineTool({
  description:
    "Search HCB transactions by memo substring, amount range (in cents), and/or ISO date range. Client-side filter over paginated results (capped). Useful for answering 'find the $42 charge for badges' or 'what did we spend on food last month?'.",
  access: { risk: "read" },
  input: findTransactionsInput,
  execute: async (input) => {
    const all = await hcbPaginate(
      `/organizations/${hcbOrgSlug()}/transactions`,
      {},
      { maxItems: 500, maxPages: 10, perPage: 100 },
      hcbTransactionSchema,
    );
    const predicate = buildTransactionFilter(input);
    const filtered = all.filter(predicate);
    return filtered.slice(0, input.limit ?? 50).map(projectTransaction);
  },
});
