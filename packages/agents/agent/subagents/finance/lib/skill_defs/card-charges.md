---
description: List Hack Club Bank card charges with optional cardholder filter for microgrant spend tracking.
---

## When to use

Use when the user asks about card charges, HCB card spend, specific merchant purchases, or per-person grant spend.

## Relevant tools

`list_card_charges`

## Instructions

<listing>

- list_card_charges returns merchant memo, cardholder name, amount_cents (negative = outflow), pending flag, and a receipts summary {count, missing}.
- The `href` field deep-links to the underlying transaction at `hcb.hackclub.com/hcb/{txn_id}`.
  </listing>

<user_filter>

- Pass `user` with a substring (case-insensitive) to match cardholder name or email.
- Primary use case: microgrant spend tracking — "how much has $recipient charged on the HCB card?".
- User-filtered queries paginate up to 500 charges; unfiltered queries return a single page (default 50).
  </user_filter>

<receipts>

- A `receipts: { missing: true }` flag means the cardholder hasn't uploaded a receipt yet. Escalate to the Treasurer if needed.
- Receipt files themselves are not accessible via the API — link to `hcb.hackclub.com/hcb/{txn_id}`.
  </receipts>
