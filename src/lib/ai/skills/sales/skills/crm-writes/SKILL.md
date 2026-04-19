---
name: crm-writes
description: Update Company and Contact fields — status, email, next follow-up.
criteria: Use when the user wants to change a Company or Contact row (e.g. mark "Contacted", set an email, schedule a follow-up).
tools:
  [
    update_company_status,
    update_company_email,
    update_company_next_followup,
    update_contact_status,
    update_contact_email,
  ]
minRole: organizer
mode: inline
---

<before-writing>
- Always call `retrieve_crm_schema` first. Select option names must match exactly (Companies Status options differ from Contacts Status options).
- Confirm the target page id via `list_companies` / `list_contacts` if the user referred to a row by name.
</before-writing>

<status-options>
- Companies Status: `Not Contacted`, `Contacted`, `Awaiting Response`, `Donated` (verify via schema — there are 8 options total).
- Contacts Status: `New`, `Nurturing`, `Active`, `Inactive`.
</status-options>

<scope>
- Only write the fields the user explicitly asked for.
- `update_company_next_followup` accepts an ISO `YYYY-MM-DD` date, or `null` to clear.
- Setting an email does not trigger outreach — use `outreach-send` for that.
</scope>
