---
name: outreach-send
description: Send outreach emails via Resend and record the Resend id on the target page.
criteria: Use when the user wants to send a cold outreach email to a Company or Contact.
tools: [send_outreach_email, set_company_last_outreach, set_contact_last_outreach]
minRole: organizer
mode: inline
---

<preflight>
- `send_outreach_email` refuses to send if `Do Not Contact` is checked on the target page.
- Verify the recipient address via `verify_email` first (see email-enrichment) and abort on `undeliverable` / `risky` / `disposable`.
- `target` must be `"company"` or `"contact"` — this selects which data source the tracking properties are written to.
</preflight>

<sending>
- `from` is always `SALES_FROM_EMAIL` (set in env). You cannot override it here.
- `replyTo` uses `SALES_REPLY_TO_EMAIL` if set.
- Pass a plain-text `text` body. `html` is optional; no React Email rendering.
- No link rewriting — tracking is done by Resend's native open/click events and the webhook.
</sending>

<tracking>
- `send_outreach_email` writes `Last Outreach ID` = Resend email id and `Outreach Status` = `Sent` on the target page. Do not also call `set_company_last_outreach` / `set_contact_last_outreach` — those exist for reconciling state after manual edits.
- Subsequent Resend events (delivered/opened/clicked/bounced) are applied by the `/api/webhooks/resend` handler — not this agent.
</tracking>
