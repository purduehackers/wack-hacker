---
name: emails
description: Look up and cancel individual Resend emails.
criteria: Use when the user wants to check delivery status of a sent email or cancel a scheduled one.
tools: [get_email, cancel_email]
minRole: organizer
mode: inline
---

- get_email returns the current delivery status (sent, delivered, bounced, complained, opened, clicked).
- cancel_email only works on scheduled emails that haven't sent yet.
- For mass campaigns use the broadcasts skill, not this one.
