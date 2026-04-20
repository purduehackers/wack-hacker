---
name: deals-management
description: Create and update Deal rows in the CRM.
criteria: Use when the user wants to create a Deal, change a Deal's Stage, or edit Deal fields (amount, priority, close date, notes).
tools: [create_deal, update_deal_stage, update_deal]
minRole: organizer
mode: inline
---

<stages>
- Deal Stage is a status property with options: `Lead`, `Qualified`, `Proposal`, `Negotiation`, `Won`, `Lost`.
- Stage transitions are manual — never auto-advance based on email events or elapsed time.
- Use `update_deal_stage` for Stage changes; `update_deal` for everything else.
</stages>

<creating>
- New Deals default to Stage `Lead` unless the user specifies otherwise.
- Amount is a USD number (no currency symbols).
- Priority options: `High`, `Medium`, `Low`.
- Close date is an ISO `YYYY-MM-DD`.
- Notes write to the Notes rich_text property.
</creating>

<scope>
- Only set fields the user explicitly asked for.
- There are no Notion relations between Deals and Companies/Contacts — reference pages in prose instead.
</scope>
