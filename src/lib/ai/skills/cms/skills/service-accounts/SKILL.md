---
name: service-accounts
description: Manage service-account (API-key-only) identities in the CMS — bots and integrations
criteria: Use when the user asks about CMS service accounts, revoking API keys, or provisioning a new integration identity
tools:
  [
    list_service_accounts,
    get_service_account,
    create_service_account,
    update_service_account,
    delete_service_account,
  ]
minRole: organizer
mode: inline
---

<service-accounts>

- Service accounts are API-key-only CMS identities used by bots and integrations. Each has `name`, `revoked` flag, and a role set.
- The API key itself is minted in the Payload admin UI _after_ creating the record. This tool only provisions the identity and its roles.
- Available roles: `admin`, `editor`, `viewer`, `hack_night_dashboard`, `events_website`, `wack_hacker`.
  </service-accounts>

<revocation>

- Prefer `update_service_account({ revoked: true })` over `delete_service_account` — flipping `revoked` kills the API key without dropping the row, preserving the audit trail.
- `delete_service_account` is approval-gated for genuinely-dead identities.
  </revocation>
