---
description: Manage the account's verified Email Routing destinations.
---

## When to use

Use when the user wants to add, list, or remove an address that Cloudflare is allowed to forward mail to.

## Relevant tools

`list_destination_addresses`, `get_destination_address`, `create_destination_address`, `delete_destination_address`

## Instructions

- Destinations are account-wide, not per zone, so one verified address can receive forwards from any Purdue Hackers domain.
- Creating one sends a confirmation email to that address. Until the owner clicks the link it cannot receive forwarded mail, and any rule pointing at it silently fails to deliver — always tell the user this.
- Deleting a destination breaks every rule still forwarding to it. Check `list_routing_rules` on the relevant zones first and say which forwards will stop.
