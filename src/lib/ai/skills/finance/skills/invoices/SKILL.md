---
name: invoices
description: List Hack Club Bank invoices and surface outstanding (unpaid) ones for sponsor follow-ups.
criteria: Use when the user asks about invoices, sponsor payments, billing status, or outstanding balances.
tools: [list_invoices, get_invoice, list_open_invoices]
minRole: organizer
mode: inline
---

<listing>

- list_invoices returns all invoices (any status) — sponsor name, amount_cents, status (open/paid/void), due_date, paid_at, memo.
  </listing>

<open>

- list_open_invoices paginates through all invoices and filters to those that are NOT paid/void — the fundraising team's follow-up list.
- Surface the sponsor name, amount, and due date so the user can chase them down.
  </open>
