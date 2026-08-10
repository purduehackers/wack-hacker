---
description: Manage where inbound mail for a domain is forwarded.
---

## When to use

Use when the user asks where mail to an address goes, wants to forward a new address, or wants to change or remove a forward.

## Relevant tools

`get_routing_settings`, `enable_email_routing`, `disable_email_routing`, `list_routing_rules`, `get_routing_rule`, `create_routing_rule`, `update_routing_rule`, `delete_routing_rule`, `get_catch_all_rule`, `update_catch_all_rule`, `get_routing_dns`

## Instructions

<orientation>
- `list_routing_rules` then `get_catch_all_rule` is the complete answer to "where does mail for this domain go" — an address with no rule of its own is handled by the catch-all.
- Routing is inbound only. It cannot send anything; that is the email-sending skill.
</orientation>

<forwarding>
- A rule can only forward to a destination address that already exists and is verified. Check `list_destination_addresses({ verified_only: true })` first; if the address is missing, create it and tell the user to click the confirmation link before the rule will deliver.
- `update_routing_rule` replaces the rule wholesale, so pass the full intended match and destination list.
</forwarding>

<danger>
- `enable_email_routing` takes over the zone's MX records, which stops any other mail provider on that domain from receiving mail. `disable_email_routing` stops all forwarding at once. Both need explicit confirmation of the consequence, not just of the action.
- A catch-all set to drop silently discards mail to every address without its own rule. Say that plainly before setting it.
</danger>
