---
name: domains
description: Aliases, team domains, DNS records, registrar queries (availability, pricing, auth code), and TLS certs.
criteria: Use when the user asks about URL aliases, apex domains, DNS records, domain availability or pricing on Vercel registrar, or TLS certificates.
tools:
  [
    list_aliases,
    get_alias,
    list_deployment_aliases,
    assign_alias,
    delete_alias,
    list_domains,
    get_domain,
    get_domain_config,
    delete_domain,
    list_dns_records,
    remove_dns_record,
    list_supported_tlds,
    check_domain_availability,
    get_domain_price,
    get_domain_auth_code,
    get_domain_transfer_in_status,
    get_registrar_order,
    get_cert,
    issue_cert,
    remove_cert,
  ]
minRole: organizer
mode: inline
---

<aliases>
- An alias points a hostname at a specific deployment.
- `assign_alias` can break existing production traffic — confirm before running on a prod hostname.
</aliases>

<dns>
- DNS writes aren't exposed here (the SDK's strict enum for record types makes them brittle through this subagent). For DNS changes, direct the user to the Vercel dashboard or use the CLI.
</dns>

<registrar>
- Read queries (availability, pricing, TLDs, auth code) are safe to run freely.
- Actual domain purchases (`buy_single_domain` etc.) are deliberately not exposed here — direct the user to the Vercel dashboard to avoid charging the account accidentally.
</registrar>

<certs>
- `issue_cert` re-issues TLS certs — useful after domain verification. Generally only needed when Vercel's auto-issue fails.
- `remove_cert` breaks HTTPS for anything bound to it. Confirm before running.
</certs>
