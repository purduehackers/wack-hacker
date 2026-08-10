# `outreach`

The Purdue Hackers CRM and the 1:1 mail that flows out of it. Three Notion data
sources — **Companies**, **Contacts**, **Deals** — plus Hunter for finding and
verifying addresses, and Cloudflare Email Sending for the outreach send itself.

Three providers behind one domain because they answer one question: who is being
asked for money, what was said to them, and what happened next. Outreach state
is not a separate system — it lives on the Company or Contact row that received
the mail, written by `send_outreach_email` at send time.

It owns neither DNS nor bulk mail. Sending-domain records are created through
the `cloudflare` subagent; event announcements go through the CMS send pipeline.
There is no mass-campaign tooling here at all — see AGENTS.md.

The CRM's property names and select options are live workspace state, so
`retrieve_crm_schema` is the first call before any write.

<!-- generated: do not edit below this line -->

## Surface

**23 tools** across **5 skills**, plus 7 always-available.

## Skills

| Skill                                                    | Role      | Tools | Description                                                                   |
| -------------------------------------------------------- | --------- | ----: | ----------------------------------------------------------------------------- |
| [`crm-writes`](lib/skill_defs/crm-writes.md)             | organizer |     9 | Update Company and Contact fields — status, email, next follow-up.            |
| [`deals-management`](lib/skill_defs/deals-management.md) | organizer |     3 | Create and update Deal rows in the CRM.                                       |
| [`email-enrichment`](lib/skill_defs/email-enrichment.md) | organizer |     2 | Find and verify email addresses via Hunter.io.                                |
| [`emails`](lib/skill_defs/emails.md)                     | organizer |     1 | Send one outreach email to one person, from the CRM row that identifies them. |
| [`status-tracking`](lib/skill_defs/status-tracking.md)   | organizer |     1 | Read the outreach tracking properties off a Company or Contact row.           |

## Always available

Reachable without loading a skill.

| Tool                  | Risk | Role   | What it does                                                                          |
| --------------------- | ---- | ------ | ------------------------------------------------------------------------------------- |
| `get_company`         | read | public | Retrieve a single Company page by its Notion page ID.                                 |
| `get_contact`         | read | public | Retrieve a single Contact page by its Notion page ID.                                 |
| `get_deal`            | read | public | Retrieve a single Deal page by its Notion page ID.                                    |
| `list_companies`      | read | public | List Company pages in the CRM.                                                        |
| `list_contacts`       | read | public | List Contact pages in the CRM.                                                        |
| `list_deals`          | read | public | List Deal pages in the CRM.                                                           |
| `retrieve_crm_schema` | read | public | Retrieve the live schema for all three CRM data sources (Companies, Contacts, Deals). |

## `crm-writes`

Update Company and Contact fields — status, email, next follow-up.

| Tool                           | Risk        | Role      | What it does                                    |
| ------------------------------ | ----------- | --------- | ----------------------------------------------- |
| `archive_company`              | destructive | organizer | Archive (soft-delete) a Company CRM row.        |
| `archive_contact`              | destructive | organizer | Archive (soft-delete) a Contact CRM row.        |
| `create_company`               | write       | organizer | Create a new Company row in the CRM.            |
| `create_contact`               | write       | organizer | Create a new Contact row in the CRM.            |
| `update_company_email`         | write       | organizer | Set the Company Email property.                 |
| `update_company_next_followup` | write       | organizer | Set the Company "Next Follow-up" date property. |
| `update_company_status`        | write       | organizer | Set the Company Status property.                |
| `update_contact_email`         | write       | organizer | Set the Contact Email property.                 |
| `update_contact_status`        | write       | organizer | Set the Contact Status property.                |

## `deals-management`

Create and update Deal rows in the CRM.

| Tool                | Risk  | Role      | What it does                                                        |
| ------------------- | ----- | --------- | ------------------------------------------------------------------- |
| `create_deal`       | write | organizer | Create a new Deal row.                                              |
| `update_deal`       | write | organizer | Update arbitrary Deal fields (amount, priority, close date, notes). |
| `update_deal_stage` | write | organizer | Update a Deal's Stage.                                              |

## `email-enrichment`

Find and verify email addresses via Hunter.io.

| Tool                  | Risk | Role   | What it does                                           |
| --------------------- | ---- | ------ | ------------------------------------------------------ |
| `find_email_for_lead` | read | public | Look up an email address via Hunter.                   |
| `verify_email`        | read | public | Verify an email address via Hunter /v2/email-verifier. |

## `emails`

Send one outreach email to one person, from the CRM row that identifies them.

| Tool                  | Risk        | Role      | What it does                                                                                                           |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `send_outreach_email` | destructive | organizer | Send one outreach email to one recipient and record the message id on the target Notion row ("Last Outreach ID", "Out… |

## `status-tracking`

Read the outreach tracking properties off a Company or Contact row.

| Tool               | Risk | Role   | What it does                                                         |
| ------------------ | ---- | ------ | -------------------------------------------------------------------- |
| `get_email_status` | read | public | Read the outreach tracking properties off a Company or Contact page. |
