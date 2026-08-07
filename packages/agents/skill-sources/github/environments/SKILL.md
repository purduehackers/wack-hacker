---
name: environments
description: Manage deployment environments — protection rules, wait timers, required reviewers.
criteria: Use when the user wants to create/update/delete a deployment environment or view its protection rules.
tools: [list_environments, get_environment, create_or_update_environment, delete_environment]
minRole: organizer
mode: inline
---

- Environments gate deployments with wait timers, required reviewers, and branch restrictions.
- reviewers is an array of `{ type: 'User' | 'Team', id: number }` — resolve team IDs via list_teams.
- deployment_branch_policy controls which branches can deploy: protected_branches, custom_branch_policies, or both false to allow all.
- Delete confirmation required — deployments lose their environment association.
