---
name: donations
description: List Hack Club Bank donations and total them over a date range for fundraising reporting.
criteria: Use when the user asks about donations, donors, recurring donations, or fundraising totals over a period.
tools: [list_donations, donation_totals]
minRole: organizer
mode: inline
---

<listing>

- list_donations returns donations with donor name (or "(anonymous)"), amount_cents, status, recurring flag, and any message.
- Anonymous donations hide the donor name and email.
  </listing>

<totals>

- donation_totals sums **settled** donations (status in `deposited` / `succeeded` / `in_transit`) within an ISO date range.
- Returns total_cents, count, recurring_cents, and one_time_cents.
- Use this to answer "what did we raise this month?" or break down recurring vs one-time support.
- If a donation is still pending (e.g. `pending` or `failed`), it's excluded from the total.
  </totals>
