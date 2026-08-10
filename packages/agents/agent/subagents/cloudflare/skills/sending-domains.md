---
description: Onboard and inspect domains authorized to send mail.
---

## When to use

Use when the user wants to start sending from a new domain, or asks why sending from a domain is failing.

## Relevant tools

`list_sending_subdomains`, `get_sending_subdomain`, `create_sending_subdomain`, `delete_sending_subdomain`, `get_sending_dns_records`

## Instructions

<onboarding>
1. `create_sending_subdomain` for the domain or subdomain to send from.
2. `get_sending_dns_records` to read the SPF, DKIM and DMARC records it requires.
3. Create each one with `create_dns_record` from the dns-records skill.
4. `get_sending_subdomain` to confirm verification before anyone tries to send.
</onboarding>

<notes>
- Cloudflare publishes these under a `cf-bounce` subdomain, so onboarding an apex domain does not disturb the apex's own MX or SPF.
- If the zone already has an SPF record, extend it with an `include:` rather than adding a second — a domain with two SPF records fails authentication entirely.
- Deleting a sending domain immediately breaks every service sending as it. Ask what else sends from that domain before removing it.
</notes>
