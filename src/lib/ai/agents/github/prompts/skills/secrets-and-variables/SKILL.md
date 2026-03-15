---
name: secrets-and-variables
description: "Manage repository and organization secrets and variables for GitHub Actions."
criteria: Use when the user wants to view, create, update, or delete secrets or variables at the repo or org level.
tools: list_repo_secrets, create_or_update_repo_secret, delete_repo_secret, list_repo_variables, create_or_update_repo_variable, delete_repo_variable, list_org_secrets, create_or_update_org_secret, delete_org_secret, list_org_variables, create_or_update_org_variable, delete_org_variable
---

<secrets>
- Secret values are encrypted and write-only — you can list names but never read values.
- `create_or_update_repo_secret` and `create_or_update_org_secret` handle encryption automatically.
- Deleting secrets requires approval.
- Org secrets have visibility scopes: "all" (all repos), "private" (private repos only), or "selected" (specific repos).
</secrets>

<variables>
- Variables are readable, unlike secrets. Use variables for non-sensitive configuration.
- `create_or_update_repo_variable` creates if it doesn't exist, updates if it does.
- Same for `create_or_update_org_variable`.
- Deleting variables requires approval.
- Org variables also have visibility scopes.
</variables>

<guidance>
- When the user says "env var" or "config", clarify whether they mean a secret (sensitive, not readable) or a variable (non-sensitive, readable).
- For sensitive values (API keys, tokens, passwords), always use secrets.
- For non-sensitive values (feature flags, URLs, environment names), use variables.
</guidance>
