---
description: Send a one-off transactional email from a verified domain.
---

## When to use

Use when the user wants to send a single email that is not CRM outreach and not an event blast.

## Relevant tools

`send_email`

## Instructions

<before-sending>
- The From address must be on a domain onboarded for Email Sending. `list_sending_subdomains` confirms it; a domain that merely has DNS records is not enough.
- Show the user the exact From, To, subject and body and get agreement before calling. This cannot be recalled.
</before-sending>

<after-sending>
- Read the result rather than assuming success. `permanent_bounces` comes back inside a successful response, so an address listed there was not delivered even though nothing threw.
- `queued` means accepted for later delivery, not delivered. Report it as queued.
- Keep the `message_id` — it is how a specific send is looked up later.
</after-sending>

<wrong-tool>
- CRM outreach to a company or contact goes through the outreach subagent's `send_outreach_email`, which also honors Do Not Contact and records the send. Do not reimplement that here.
- Event and RSVP blasts belong to the CMS send pipeline. This service is transactional only and must not be used for newsletters.
</wrong-tool>
