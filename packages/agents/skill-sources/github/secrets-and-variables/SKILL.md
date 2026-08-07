---
name: secrets-and-variables
description: Manage repository and organization secrets and variables for GitHub Actions.
criteria: Use when the user wants to view, create, update, or delete secrets or variables.
tools:
  [
    list_repo_secrets,
    create_or_update_repo_secret,
    delete_repo_secret,
    list_repo_variables,
    create_or_update_repo_variable,
    delete_repo_variable,
    list_org_secrets,
    create_or_update_org_secret,
    delete_org_secret,
    list_org_variables,
    create_or_update_org_variable,
    delete_org_variable,
  ]
minRole: organizer
mode: inline
---

<secrets>
- Values are encrypted and write-only — you can list names but never read values.
- Encryption is handled automatically by the tools.
- Org secrets have visibility scopes: "all", "private", or "selected".
- Deleting requires approval.
</secrets>

<variables>
- Variables are readable, unlike secrets. Use for non-sensitive configuration.
- create_or_update creates if nonexistent, updates if it does.
- Org variables also have visibility scopes.
</variables>

<guidance>
- "env var" or "config" -> clarify whether they mean secret (sensitive) or variable (non-sensitive).
- API keys, tokens, passwords -> always use secrets.
- Feature flags, URLs, environment names -> use variables.
</guidance>
