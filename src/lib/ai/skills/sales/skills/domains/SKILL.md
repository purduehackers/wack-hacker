---
name: domains
description: Manage Resend sending domains and their DNS verification.
criteria: Use when the user wants to register a new sending domain, check verification status, or delete a domain (admin only for writes).
tools: [list_domains, get_domain, create_domain, verify_domain, delete_domain]
minRole: admin
mode: inline
---

- create_domain returns DNS records the user must add at their registrar.
- After DNS is configured, call verify_domain to kick off re-verification.
- get_domain shows the current records and their match status.
- delete_domain stops all sending from that domain immediately.
