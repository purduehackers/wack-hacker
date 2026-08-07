---
name: email-enrichment
description: Find and verify email addresses via Hunter.io.
criteria: Use when the user asks to find an email for a lead, enrich a Company's contact info, or verify whether an address is deliverable.
tools: [find_email_for_lead, verify_email]
minRole: organizer
mode: inline
---

<finding>
- `find_email_for_lead` needs a domain. Provide it directly, or pass a Notion `page_id` so the tool can read Website / Email and derive one.
- If `full_name` (or `first_name` + `last_name`) is passed, Hunter `/v2/email-finder` returns a specific address.
- Without a name, the tool falls back to `/v2/domain-search` and returns up to 10 candidate addresses with confidence scores.
- Never guess email patterns locally — always route through Hunter.
</finding>

<verifying>
- Always call `verify_email` before sending.
- Block sends on `status`/`result` values of `undeliverable` or `risky` unless the user explicitly overrides.
- `disposable: true` should also block automated outreach.
</verifying>

<scope>
- Finding and verifying does not write to Notion. Use `crm-writes` (`update_company_email` / `update_contact_email`) to persist a verified address.
</scope>
