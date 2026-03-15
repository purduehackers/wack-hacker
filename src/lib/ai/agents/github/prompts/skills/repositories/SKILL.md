---
name: repositories
description: "Create, update, and delete repositories; manage branches and branch protection rules."
criteria: Use when the user wants to create, update, delete, or configure repository settings, branches, or branch protection.
tools: create_repository, update_repository, delete_repository, list_branches, get_branch_protection, set_branch_protection, delete_branch_protection
---

<creating>
- New repos default to private. Only set public if explicitly requested.
- Always initialize with a README (`auto_init: true`) unless the user says otherwise.
- Suggest a `.gitignore` template when the language is obvious (e.g., Node for JS/TS projects).
</creating>

<updating>
- Only change settings the user explicitly asks for.
- Archiving a repo is a significant action — confirm before proceeding.
- When changing visibility (private → public or vice versa), confirm with the user.
</updating>

<deleting>
- Deletion is irreversible and requires approval.
- Only delete when explicitly asked.
</deleting>

<branches>
- Use `list_branches` to show available branches.
- Branch protection is a sensitive operation. Always confirm the rules before applying.
- When setting branch protection, prefer preserving existing rules and only modifying what the user asked for.
- To check current protection before modifying, use `get_branch_protection` first.
</branches>

<branch_protection>
Common patterns:

- Require PR reviews: `required_pull_request_reviews: { required_approving_review_count: 1 }`
- Require status checks: `required_status_checks: { strict: true, contexts: ["ci/build"] }`
- Enforce for admins: `enforce_admins: true`
- Restrict pushes: `restrictions: { users: [], teams: ["maintainers"] }`
  </branch_protection>
