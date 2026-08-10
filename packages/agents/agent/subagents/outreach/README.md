# `outreach`

The Purdue Hackers CRM and the 1:1 mail that flows out of it. Three Notion data
sources — **Companies**, **Contacts**, **Deals** — plus Resend for audiences,
broadcasts and sending domains, Hunter for finding and verifying addresses, and
Cloudflare Email Sending for the individual outreach send.

Four providers behind one domain because they answer one question: who is being
asked for money, what was said to them, and what happened next. Outreach state
is not a separate system — it lives on the Company or Contact row that received
the mail, written by `send_outreach_email` at send time.

It does not own DNS. The records a sending domain needs are created through the
`cloudflare` subagent; the `domains` skill here only registers and verifies a
domain with Resend. It does not own event mail either — announcements go through
the CMS send pipeline, and transactional mail through `cloudflare`'s Email
Sending.

The CRM's property names and select options are live workspace state, so
`retrieve_crm_schema` is the first call before any write.

<!-- generated: do not edit below this line -->

## Surface

**42 tools** across **8 skills**, plus 7 always-available.

## Skills

| Skill                                            | Role      | Tools | Description                                                          |
| ------------------------------------------------ | --------- | ----: | -------------------------------------------------------------------- |
| [`audiences`](skills/audiences.md)               | organizer |     7 | Manage Resend audiences (segments) and their contact rosters.        |
| [`broadcasts`](skills/broadcasts.md)             | organizer |     5 | Manage Resend broadcasts — mass email campaigns to audiences.        |
| [`crm-writes`](skills/crm-writes.md)             | organizer |     9 | Update Company and Contact fields — status, email, next follow-up.   |
| [`deals-management`](skills/deals-management.md) | organizer |     3 | Create and update Deal rows in the CRM.                              |
| [`domains`](skills/domains.md)                   | admin     |     5 | Manage Resend sending domains and their DNS verification.            |
| [`email-enrichment`](skills/email-enrichment.md) | organizer |     2 | Find and verify email addresses via Hunter.io.                       |
| [`emails`](skills/emails.md)                     | organizer |     3 | Send one outreach email to one person, and inspect individual sends. |
| [`status-tracking`](skills/status-tracking.md)   | organizer |     1 | Read the outreach tracking properties off a Company or Contact row.  |

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

## `audiences`

Manage Resend audiences (segments) and their contact rosters.

| Tool                           | Risk        | Role      | What it does                                                 |
| ------------------------------ | ----------- | --------- | ------------------------------------------------------------ |
| `add_contact_to_audience`      | write       | organizer | Add a contact to a Resend segment (audience) by email.       |
| `create_audience`              | write       | organizer | Create a new Resend segment (audience).                      |
| `delete_audience`              | destructive | organizer | Delete a Resend segment (audience).                          |
| `get_audience`                 | read        | public    | Get a single Resend segment (audience) by ID.                |
| `list_audiences`               | read        | public    | List Resend segments (audiences) used for grouping contacts. |
| `list_contacts_in_audience`    | read        | public    | List contacts in a Resend segment (audience).                |
| `remove_contact_from_audience` | destructive | organizer | Remove a contact from a Resend segment (audience).           |

## `broadcasts`

Manage Resend broadcasts — mass email campaigns to audiences.

| Tool               | Risk        | Role      | What it does                                                               |
| ------------------ | ----------- | --------- | -------------------------------------------------------------------------- |
| `create_broadcast` | write       | organizer | Create a new Resend broadcast (mass email campaign) targeting a segment.   |
| `delete_broadcast` | destructive | organizer | Delete a Resend broadcast.                                                 |
| `get_broadcast`    | read        | public    | Get a single Resend broadcast by ID, including content preview and status. |
| `list_broadcasts`  | read        | public    | List Resend broadcasts (mass email campaigns).                             |
| `send_broadcast`   | destructive | organizer | Dispatch a Resend broadcast to its target audience.                        |

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

## `domains`

Manage Resend sending domains and their DNS verification.

| Tool            | Risk        | Role   | What it does                                                                     |
| --------------- | ----------- | ------ | -------------------------------------------------------------------------------- |
| `create_domain` | destructive | admin  | Register a new sending domain on Resend.                                         |
| `delete_domain` | destructive | admin  | Permanently delete a Resend domain.                                              |
| `get_domain`    | read        | public | Get a single Resend domain by ID, including DNS records and verification status. |
| `list_domains`  | read        | public | List verified sending domains on Resend.                                         |
| `verify_domain` | destructive | admin  | Kick off verification for a Resend domain.                                       |

## `email-enrichment`

Find and verify email addresses via Hunter.io.

| Tool                  | Risk | Role   | What it does                                           |
| --------------------- | ---- | ------ | ------------------------------------------------------ |
| `find_email_for_lead` | read | public | Look up an email address via Hunter.                   |
| `verify_email`        | read | public | Verify an email address via Hunter /v2/email-verifier. |

## `emails`

Send one outreach email to one person, and inspect individual sends.

| Tool                  | Risk        | Role      | What it does                                                                                                           |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cancel_email`        | destructive | organizer | Cancel a scheduled Resend email that has not yet been sent.                                                            |
| `get_email`           | read        | public    | Retrieve a Resend email by ID.                                                                                         |
| `send_outreach_email` | destructive | organizer | Send one outreach email to one recipient and record the message id on the target Notion row ("Last Outreach ID", "Out… |

## `status-tracking`

Read the outreach tracking properties off a Company or Contact row.

| Tool               | Risk | Role   | What it does                                                         |
| ------------------ | ---- | ------ | -------------------------------------------------------------------- |
| `get_email_status` | read | public | Read the outreach tracking properties off a Company or Contact page. |
