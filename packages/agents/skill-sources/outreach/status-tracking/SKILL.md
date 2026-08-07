---
name: status-tracking
description: Read the outreach tracking properties off a Company or Contact row.
criteria: Use when the user wants to check whether an outreach landed, was opened, or bounced.
tools: [get_email_status]
minRole: organizer
mode: inline
---

<reading>
- `get_email_status` returns `Last Outreach ID`, `Outreach Status`, `Outreach Last Event At`, and `Do Not Contact` for a given page.
- The Resend webhook is authoritative — these values reflect the latest event received.
</reading>

<event-mapping>
- `email.sent` -> `Outreach Status` = Sent
- `email.delivered` -> Delivered
- `email.opened` -> Opened (monotonic; never regressed past Clicked)
- `email.clicked` -> Clicked
- `email.bounced` / `email.complained` -> Bounced + `Do Not Contact` flipped to true
</event-mapping>

<scope>
- This skill is read-only. Use `crm-writes` to change any property manually.
</scope>
