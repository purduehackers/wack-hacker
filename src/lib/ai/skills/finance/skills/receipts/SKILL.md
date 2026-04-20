---
name: receipts
description: Check which Hack Club Bank transactions are missing an attached receipt. Files themselves are NOT available via API.
criteria: Use when the user asks about missing receipts, receipt status for a charge, or wants to chase down receipt uploads.
tools: [list_missing_receipts, get_receipt_status]
minRole: organizer
mode: inline
---

<scope>

- This covers **HCB card charges and HCB reimbursements only** (which is where Purdue Hackers runs microgrant spend).
- Organization-wide reimbursements go through **Purdue's BOSO portal**, not HCB. If the user is chasing BOSO receipts, this skill cannot help — redirect them to the `#receipts` Discord channel / BOSO workflow.
  </scope>

<api_limitation>

- HCB's public API v3 exposes **only a `receipts: { count, missing }` summary** on each transaction. No receipt file URLs, IDs, filenames, or bytes are available.
- To upload or view the actual receipt image/PDF, the user must go to `hcb.hackclub.com/hcb/{txn_id}`. Always link them there.
  </api_limitation>

<listing_missing>

- list_missing_receipts paginates through recent transactions and surfaces those with `receipts.missing === true`.
- Each row includes the transaction id, date, amount_cents, memo, and a direct `href` to the HCB UI for upload.
  </listing_missing>

<single_status>

- get_receipt_status looks up a single transaction and returns `{ id, count, missing, href }`.
  </single_status>
