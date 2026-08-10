---
description: Send one outreach email to one person, and inspect individual sends.
---

## When to use

Use when the user wants to email a specific company or contact, check the delivery status of a sent email, or cancel a scheduled one.

## Relevant tools

`send_outreach_email`, `get_email`, `cancel_email`

## Instructions

<sending>
- `send_outreach_email` is the only way to email one person. It is approval-gated and cannot be undone.
- Always `verify_email` first, and never send to an address whose status is undeliverable, risky, or disposable.
- The tool refuses on its own when `Do Not Contact` is set or the row is from the wrong data source. Treat a refusal as final — do not retry with a different target.
- On success it writes the message id and status back to the Notion row itself. Do not write those properties by hand.
</sending>

<inspecting>
- get_email returns the current delivery status (sent, delivered, bounced, complained, opened, clicked).
- cancel_email only works on scheduled emails that haven't sent yet.
- For mass campaigns use the broadcasts skill, not this one.
</inspecting>
