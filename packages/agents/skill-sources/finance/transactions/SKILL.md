---
name: transactions
description: List, inspect, and search Hack Club Bank transactions by memo, amount, or date range.
criteria: Use when the user asks about recent transactions, a specific charge, or wants to find transactions by memo/amount/date.
tools: [list_transactions, get_transaction, find_transactions]
minRole: organizer
mode: inline
---

<listing>

- list_transactions returns the most recent transactions (newest first). Page with `per_page` + `page`.
- Each item: id, date, amount_cents (negative = outflow), memo, type, pending flag, and a receipts summary {count, missing}.
  </listing>

<details>

- get_transaction returns a single transaction by id, including the receipts summary.
- Link to the HCB web UI via the `href` field (`hcb.hackclub.com/hcb/{id}`).
  </details>

<search>

- find_transactions does a client-side filter over up to 500 recent transactions.
- Filters: memo_contains (case-insensitive substring), min/max_amount_cents (signed), since/until (ISO date), pending ("only" / "exclude" / "any").
- Useful for "find the $42 charge for badges" or "what did we spend on food last month?" — combine memo_contains with a date range.
- Amounts are in cents and signed; pass `max_amount_cents: -100` to find outflows ≥ $1.00, for example.
  </search>
