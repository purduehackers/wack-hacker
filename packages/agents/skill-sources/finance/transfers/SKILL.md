---
name: transfers
description: View Hack Club Bank inter-org transfers (disbursements between HCB organizations).
criteria: Use when the user asks about transfers, disbursements, or money sent to / received from another HCB org.
tools: [list_transfers, get_transfer]
minRole: organizer
mode: inline
---

<listing>

- list_transfers shows sender + receiver (org name or slug), amount_cents, status, memo, and created_at.
- These are specifically **inter-org** HCB transfers — for regular card charges or reimbursements, use `card-charges` or `transactions`.
  </listing>
