---
description: Read the outreach tracking properties off a Company or Contact row.
---

## When to use

Use when the user wants to check whether an outreach landed, was opened, or bounced.

## Relevant tools

`get_email_status`

## Instructions

<reading>
- `get_email_status` returns `Last Outreach ID`, `Outreach Status`, `Outreach Last Event At`, and `Do Not Contact` for a given page.
- `send_outreach_email` is what writes them, at send time. Nothing updates them afterwards, so `Sent` means "we sent it", not "it was delivered" — say so rather than implying delivery.
- To find out what actually happened to a specific send, take the `Last Outreach ID` and call `get_email` in the emails skill.
</reading>

<scope>
- This skill is read-only. Use `crm-writes` to change any property manually.
</scope>
