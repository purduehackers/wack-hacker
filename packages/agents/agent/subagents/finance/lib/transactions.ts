import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug, hcbPaginate, hcbTxnUrl, paginationQuery } from "./client.ts";
import { paginationInputShape } from "./constants.ts";
import {
  type HcbTransaction,
  hcbTransactionSchema,
  projectTransaction,
} from "./transaction-shape.ts";

/** List the most recent transactions. */
export const list_transactions = defineTool({
  description:
    "List recent HCB transactions for Purdue Hackers — newest first. Each transaction includes id, date, amount_cents (negative = outflow), memo, type, pending flag, and a receipts summary {count, missing}. Receipt files themselves are NOT available via HCB's API; only whether a receipt is attached.",
  access: { risk: "read" },
  input: z.strictObject(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/transactions`,
      paginationQuery(input),
      z.array(hcbTransactionSchema),
    );
    return data.map(projectTransaction);
  },
});

/** Get a single transaction by id. */
export const get_transaction = defineTool({
  description:
    "Get a single HCB transaction by id. Returns a compact summary with id, date, amount_cents (negative = outflow), memo, type, pending flag, receipts summary {count, missing}, and href. Receipt files themselves are NOT available via HCB's API; only whether a receipt is attached — visit hcb.hackclub.com/hcb/{id} for the actual file.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("HCB transaction id (e.g. 'txn_abc123')"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/transactions/${id}`, undefined, hcbTransactionSchema);
    return { ...projectTransaction(data), href: hcbTxnUrl(id) };
  },
});

/** Search transactions by memo substring, amount range, and/or date range. */
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

type FindFilter = z.output<typeof findTransactionsInput>;

function buildTransactionFilter(f: FindFilter): (t: HcbTransaction) => boolean {
  const needle = f.memo_contains?.toLowerCase();
  const sinceTs = f.since ? Date.parse(f.since) : undefined;
  const untilTs = f.until ? Date.parse(f.until) : undefined;
  return (t) => {
    if (needle && !(t.memo ?? "").toLowerCase().includes(needle)) return false;
    if (f.min_amount_cents !== undefined && (t.amount_cents ?? 0) < f.min_amount_cents)
      return false;
    if (f.max_amount_cents !== undefined && (t.amount_cents ?? 0) > f.max_amount_cents)
      return false;
    if (sinceTs !== undefined && t.date && Date.parse(t.date) < sinceTs) return false;
    if (untilTs !== undefined && t.date && Date.parse(t.date) > untilTs) return false;
    if (f.pending === "only" && !t.pending) return false;
    if (f.pending === "exclude" && t.pending) return false;
    return true;
  };
}
