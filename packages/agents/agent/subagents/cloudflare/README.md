# `cloudflare`

DNS, inbound mail, and outbound transactional mail for every Purdue Hackers
domain on the `purduehackers` Cloudflare account.

Three surfaces that share only DNS. **Email Routing** forwards mail _to_ a
domain; **Email Sending** sends mail _from_ it; **DNS** is the substrate both
authenticate against. A request about one is never answered by the other.

It does not own outreach or event mail. CRM sends go through the `outreach`
subagent's `send_outreach_email`, which honors Do Not Contact and records the
send; event blasts go through the CMS send pipeline. Email Sending here is
transactional only.

Zone ids are what the tools take and domain names are what people say, so
`list_zones` is almost always the first call.

<!-- generated: do not edit below this line -->

## Surface

**29 tools** across **5 skills**, plus 2 always-available.

## Skills

| Skill                                                      | Role      | Tools | Description                                                |
| ---------------------------------------------------------- | --------- | ----: | ---------------------------------------------------------- |
| [`dns-records`](skills/dns-records.md)                     | organizer |     6 | Read and change DNS records on a Cloudflare zone.          |
| [`email-routing`](skills/email-routing.md)                 | organizer |    11 | Manage where inbound mail for a domain is forwarded.       |
| [`destination-addresses`](skills/destination-addresses.md) | organizer |     4 | Manage the account's verified Email Routing destinations.  |
| [`email-sending`](skills/email-sending.md)                 | organizer |     1 | Send a one-off transactional email from a verified domain. |
| [`sending-domains`](skills/sending-domains.md)             | organizer |     5 | Onboard and inspect domains authorized to send mail.       |

## Always available

Reachable without loading a skill.

| Tool         | Risk | Role   | What it does                                                         |
| ------------ | ---- | ------ | -------------------------------------------------------------------- |
| `get_zone`   | read | public | Retrieve one zone's details by id, including status and nameservers. |
| `list_zones` | read | public | List the Cloudflare zones on this account.                           |

## `dns-records`

Read and change DNS records on a Cloudflare zone.

| Tool                | Risk        | Role      | What it does                               |
| ------------------- | ----------- | --------- | ------------------------------------------ |
| `create_dns_record` | write       | organizer | Create a DNS record.                       |
| `delete_dns_record` | destructive | organizer | Permanently delete a DNS record.           |
| `export_zone_file`  | read        | public    | Export the whole zone as a BIND zone file. |
| `get_dns_record`    | read        | public    | Retrieve one DNS record by id.             |
| `list_dns_records`  | read        | public    | List DNS records in a zone.                |
| `update_dns_record` | write       | organizer | Overwrite a DNS record.                    |

## `email-routing`

Manage where inbound mail for a domain is forwarded.

| Tool                    | Risk        | Role      | What it does                                                                                                    |
| ----------------------- | ----------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `create_routing_rule`   | write       | organizer | Forward one address to one or more verified destinations.                                                       |
| `delete_routing_rule`   | destructive | organizer | Delete an Email Routing rule.                                                                                   |
| `disable_email_routing` | destructive | organizer | Turn Email Routing off for a zone.                                                                              |
| `enable_email_routing`  | destructive | organizer | Turn Email Routing on for a zone.                                                                               |
| `get_catch_all_rule`    | read        | public    | Read the catch-all rule — what happens to mail for any address on the domain that no other rule matched.        |
| `get_routing_dns`       | read        | public    | Show the DNS records Email Routing needs on a zone, and whether they are currently present and correct.         |
| `get_routing_rule`      | read        | public    | Retrieve one Email Routing rule by id.                                                                          |
| `get_routing_settings`  | read        | public    | Read Email Routing status for a zone — whether it is enabled, and whether the required MX records are in place. |
| `list_routing_rules`    | read        | public    | List every Email Routing rule for a zone — which addresses forward where, in priority order.                    |
| `update_catch_all_rule` | destructive | organizer | Set the catch-all behavior for a domain: forward everything unmatched to verified destinations, or drop it.     |
| `update_routing_rule`   | write       | organizer | Replace an Email Routing rule's match and destinations.                                                         |

## `destination-addresses`

Manage the account's verified Email Routing destinations.

| Tool                         | Risk        | Role      | What it does                                                                             |
| ---------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------- |
| `create_destination_address` | write       | organizer | Add a destination address.                                                               |
| `delete_destination_address` | destructive | organizer | Remove a destination address from the account.                                           |
| `get_destination_address`    | read        | public    | Retrieve one destination address by id.                                                  |
| `list_destination_addresses` | read        | public    | List the account's Email Routing destination addresses and whether each one is verified. |

## `email-sending`

Send a one-off transactional email from a verified domain.

| Tool         | Risk        | Role      | What it does                                                 |
| ------------ | ----------- | --------- | ------------------------------------------------------------ |
| `send_email` | destructive | organizer | Send one transactional email from a verified sending domain. |

## `sending-domains`

Onboard and inspect domains authorized to send mail.

| Tool                       | Risk        | Role      | What it does                                                                                                   |
| -------------------------- | ----------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `create_sending_subdomain` | write       | organizer | Onboard a domain for Email Sending.                                                                            |
| `delete_sending_subdomain` | destructive | organizer | Remove a sending domain.                                                                                       |
| `get_sending_dns_records`  | read        | public    | Show the SPF, DKIM and DMARC records a sending domain requires, so they can be created with create_dns_record. |
| `get_sending_subdomain`    | read        | public    | Retrieve one sending domain by id, including its verification state.                                           |
| `list_sending_subdomains`  | read        | public    | List the sending domains onboarded for Email Sending on a zone.                                                |
