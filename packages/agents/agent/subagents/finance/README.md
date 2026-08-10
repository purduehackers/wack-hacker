# `finance`

Money as Hack Club Bank records it for the Purdue Hackers organization named by
`HCB_ORG_SLUG` — balances, transactions, donations, sponsor invoices, card
charges, and inter-org transfers.

Read-only, and not by policy: HCB's public v3 API is unauthenticated and exposes
no write endpoints at all. Nothing here moves money, issues a card, voids an
invoice, or marks a receipt uploaded, and no amount of role escalation changes
that. Every amount is in cents, signed, with negative meaning an outflow.

It does not own reimbursements. Purdue Hackers routes organization-wide
reimbursements through BOSO, Purdue's portal, which HCB never sees; only
microgrant spend flows through HCB cards. A question about "the reimbursement"
is ambiguous until the system is named.

It does not own receipt files either. HCB reports only a
`receipts: { count, missing }` summary per transaction — the image or PDF lives
in the HCB web UI at `hcb.hackclub.com/hcb/{id}`, and the answer to "send me the
receipt" is that link.

<!-- generated: do not edit below this line -->

## Surface

**16 tools** across **6 skills**, plus 4 always-available.

## Skills

| Skill                                    | Role      | Tools | Description                                                                                     |
| ---------------------------------------- | --------- | ----: | ----------------------------------------------------------------------------------------------- |
| [`card-charges`](skills/card-charges.md) | organizer |     1 | List Hack Club Bank card charges with optional cardholder filter for microgrant spend tracking. |
| [`donations`](skills/donations.md)       | organizer |     3 | List Hack Club Bank donations and total them over a date range for fundraising reporting.       |
| [`invoices`](skills/invoices.md)         | organizer |     3 | List Hack Club Bank invoices and surface outstanding (unpaid) ones for sponsor follow-ups.      |
| [`receipts`](skills/receipts.md)         | organizer |     2 | Check which Hack Club Bank transactions are missing an attached receipt.                        |
| [`transactions`](skills/transactions.md) | organizer |     3 | List, inspect, and search Hack Club Bank transactions by memo, amount, or date range.           |
| [`transfers`](skills/transfers.md)       | organizer |     2 | View Hack Club Bank inter-org transfers (disbursements between HCB organizations).              |

## Always available

Reachable without loading a skill.

| Tool                | Risk | Role   | What it does                                                                                                           |
| ------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get_balance`       | read | public | Get the current Hack Club Bank balance summary for Purdue Hackers — cleared balance, incoming (pending) balance, fee … |
| `get_organization`  | read | public | Get the Hack Club Bank organization profile — name, slug, website, description, and whether Transparency Mode is enab… |
| `get_transaction`   | read | public | Get a single HCB transaction by id.                                                                                    |
| `list_transactions` | read | public | List recent HCB transactions for Purdue Hackers — newest first.                                                        |

## `card-charges`

List Hack Club Bank card charges with optional cardholder filter for microgrant spend tracking.

| Tool                | Risk | Role   | What it does                                                                                 |
| ------------------- | ---- | ------ | -------------------------------------------------------------------------------------------- |
| `list_card_charges` | read | public | List HCB card charges — merchant, user, amount_cents, and receipts summary {count, missing}. |

## `donations`

List Hack Club Bank donations and total them over a date range for fundraising reporting.

| Tool              | Risk | Role   | What it does                                                                                                           |
| ----------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `donation_totals` | read | public | Sum successful donations within an ISO date range.                                                                     |
| `get_donation`    | read | public | Fetch a single donation by ID.                                                                                         |
| `list_donations`  | read | public | List donations to the Hack Club Bank org — donor name (or '(anonymous)'), amount_cents, status, recurring flag, and m… |

## `invoices`

List Hack Club Bank invoices and surface outstanding (unpaid) ones for sponsor follow-ups.

| Tool                 | Risk | Role   | What it does                                                                                                   |
| -------------------- | ---- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `get_invoice`        | read | public | Get a single invoice by ID — sponsor name, amount_cents, status, due/paid dates, and memo.                     |
| `list_invoices`      | read | public | List invoices sent by the org — sponsor name, amount_cents, status (open/paid/void), due/paid dates, and memo. |
| `list_open_invoices` | read | public | List outstanding (unpaid) invoices only — drives fundraising follow-ups with sponsors.                         |

## `receipts`

Check which Hack Club Bank transactions are missing an attached receipt. Files themselves are NOT available via API.

| Tool                    | Risk | Role   | What it does                                                                                                        |
| ----------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `get_receipt_status`    | read | public | Report whether a given HCB transaction has a receipt attached — returns { id, receipts: { count, missing }, href }. |
| `list_missing_receipts` | read | public | List HCB transactions flagged as missing a receipt.                                                                 |

## `transactions`

List, inspect, and search Hack Club Bank transactions by memo, amount, or date range.

| Tool                | Risk | Role   | What it does                                                                               |
| ------------------- | ---- | ------ | ------------------------------------------------------------------------------------------ |
| `find_transactions` | read | public | Search HCB transactions by memo substring, amount range (in cents), and/or ISO date range. |
| `get_transaction`   | read | public | Get a single HCB transaction by id.                                                        |
| `list_transactions` | read | public | List recent HCB transactions for Purdue Hackers — newest first.                            |

## `transfers`

View Hack Club Bank inter-org transfers (disbursements between HCB organizations).

| Tool             | Risk | Role   | What it does                                                                                                           |
| ---------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get_transfer`   | read | public | Get a single HCB inter-org transfer by ID — sender, receiver, amount_cents, status, and memo.                          |
| `list_transfers` | read | public | List HCB inter-org transfers (disbursements) involving Purdue Hackers — sender, receiver, amount_cents, status, and m… |
