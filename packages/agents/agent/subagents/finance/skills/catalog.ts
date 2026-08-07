import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const FINANCE_BASE_TOOL_NAMES = [
  "get_organization",
  "get_balance",
  "list_transactions",
  "get_transaction",
] as const;

export const FINANCE_SKILL_DEFINITIONS = [
  {
    name: "card-charges",
    description:
      "List Hack Club Bank card charges with optional cardholder filter for microgrant spend tracking.",
    criteria:
      "Use when the user asks about card charges, HCB card spend, specific merchant purchases, or per-person grant spend.",
    minRole: "organizer",
    tools: ["list_card_charges"],
    instructions:
      '<listing>\n\n- list_card_charges returns merchant memo, cardholder name, amount_cents (negative = outflow), pending flag, and a receipts summary {count, missing}.\n- The `href` field deep-links to the underlying transaction at `hcb.hackclub.com/hcb/{txn_id}`.\n  </listing>\n\n<user_filter>\n\n- Pass `user` with a substring (case-insensitive) to match cardholder name or email.\n- Primary use case: microgrant spend tracking — "how much has $recipient charged on the HCB card?".\n- User-filtered queries paginate up to 500 charges; unfiltered queries return a single page (default 50).\n  </user_filter>\n\n<receipts>\n\n- A `receipts: { missing: true }` flag means the cardholder hasn\'t uploaded a receipt yet. Escalate to the Treasurer if needed.\n- Receipt files themselves are not accessible via the API — link to `hcb.hackclub.com/hcb/{txn_id}`.\n  </receipts>',
  },
  {
    name: "donations",
    description:
      "List Hack Club Bank donations and total them over a date range for fundraising reporting.",
    criteria:
      "Use when the user asks about donations, donors, recurring donations, or fundraising totals over a period.",
    minRole: "organizer",
    tools: ["list_donations", "get_donation", "donation_totals"],
    instructions:
      '<listing>\n\n- list_donations returns donations with donor name (or "(anonymous)"), amount_cents, status, recurring flag, and any message.\n- Anonymous donations hide the donor name and email.\n  </listing>\n\n<totals>\n\n- donation_totals sums **settled** donations (status in `deposited` / `succeeded` / `in_transit`) within an ISO date range.\n- Returns total_cents, count, recurring_cents, and one_time_cents.\n- Use this to answer "what did we raise this month?" or break down recurring vs one-time support.\n- If a donation is still pending (e.g. `pending` or `failed`), it\'s excluded from the total.\n  </totals>',
  },
  {
    name: "invoices",
    description:
      "List Hack Club Bank invoices and surface outstanding (unpaid) ones for sponsor follow-ups.",
    criteria:
      "Use when the user asks about invoices, sponsor payments, billing status, or outstanding balances.",
    minRole: "organizer",
    tools: ["list_invoices", "get_invoice", "list_open_invoices"],
    instructions:
      "<listing>\n\n- list_invoices returns all invoices (any status) — sponsor name, amount_cents, status (open/paid/void), due_date, paid_at, memo.\n  </listing>\n\n<open>\n\n- list_open_invoices paginates through all invoices and filters to those that are NOT paid/void — the fundraising team's follow-up list.\n- Surface the sponsor name, amount, and due date so the user can chase them down.\n  </open>",
  },
  {
    name: "receipts",
    description:
      "Check which Hack Club Bank transactions are missing an attached receipt. Files themselves are NOT available via API.",
    criteria:
      "Use when the user asks about missing receipts, receipt status for a charge, or wants to chase down receipt uploads.",
    minRole: "organizer",
    tools: ["list_missing_receipts", "get_receipt_status"],
    instructions:
      "<scope>\n\n- This covers **HCB card charges and HCB reimbursements only** (which is where Purdue Hackers runs microgrant spend).\n- Organization-wide reimbursements go through **Purdue's BOSO portal**, not HCB. If the user is chasing BOSO receipts, this skill cannot help — redirect them to the `#receipts` Discord channel / BOSO workflow.\n  </scope>\n\n<api_limitation>\n\n- HCB's public API v3 exposes **only a `receipts: { count, missing }` summary** on each transaction. No receipt file URLs, IDs, filenames, or bytes are available.\n- To upload or view the actual receipt image/PDF, the user must go to `hcb.hackclub.com/hcb/{txn_id}`. Always link them there.\n  </api_limitation>\n\n<listing_missing>\n\n- list_missing_receipts paginates through recent transactions and surfaces those with `receipts.missing === true`.\n- Each row includes the transaction id, date, amount_cents, memo, and a direct `href` to the HCB UI for upload.\n  </listing_missing>\n\n<single_status>\n\n- get_receipt_status looks up a single transaction and returns `{ id, count, missing, href }`.\n  </single_status>",
  },
  {
    name: "transactions",
    description:
      "List, inspect, and search Hack Club Bank transactions by memo, amount, or date range.",
    criteria:
      "Use when the user asks about recent transactions, a specific charge, or wants to find transactions by memo/amount/date.",
    minRole: "organizer",
    tools: ["list_transactions", "get_transaction", "find_transactions"],
    instructions:
      '<listing>\n\n- list_transactions returns the most recent transactions (newest first). Page with `per_page` + `page`.\n- Each item: id, date, amount_cents (negative = outflow), memo, type, pending flag, and a receipts summary {count, missing}.\n  </listing>\n\n<details>\n\n- get_transaction returns a single transaction by id, including the receipts summary.\n- Link to the HCB web UI via the `href` field (`hcb.hackclub.com/hcb/{id}`).\n  </details>\n\n<search>\n\n- find_transactions does a client-side filter over up to 500 recent transactions.\n- Filters: memo_contains (case-insensitive substring), min/max_amount_cents (signed), since/until (ISO date), pending ("only" / "exclude" / "any").\n- Useful for "find the $42 charge for badges" or "what did we spend on food last month?" — combine memo_contains with a date range.\n- Amounts are in cents and signed; pass `max_amount_cents: -100` to find outflows ≥ $1.00, for example.\n  </search>',
  },
  {
    name: "transfers",
    description:
      "View Hack Club Bank inter-org transfers (disbursements between HCB organizations).",
    criteria:
      "Use when the user asks about transfers, disbursements, or money sent to / received from another HCB org.",
    minRole: "organizer",
    tools: ["list_transfers", "get_transfer"],
    instructions:
      "<listing>\n\n- list_transfers shows sender + receiver (org name or slug), amount_cents, status, memo, and created_at.\n- These are specifically **inter-org** HCB transfers — for regular card charges or reimbursements, use `card-charges` or `transactions`.\n  </listing>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, FINANCE_SKILL_DEFINITIONS),
  },
});
