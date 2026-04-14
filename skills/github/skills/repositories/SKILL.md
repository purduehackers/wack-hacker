---
name: repositories
description: Create, update, and delete repositories; manage branches and branch protection.
criteria: Use when the user wants to manage repository settings, branches, or branch protection.
tools:
  [
    create_repository,
    update_repository,
    delete_repository,
    list_branches,
    get_branch_protection,
    set_branch_protection,
    delete_branch_protection,
  ]
minRole: organizer
mode: inline
---

<creating>
- New repos default to private. Only set public if explicitly requested.
- Initialize with README (auto_init: true) unless told otherwise.
</creating>

<updating>
- Only change settings explicitly asked for.
- Archiving and visibility changes require confirmation.
</updating>

<deleting>
- Deletion is irreversible and requires approval.
</deleting>

<branch_protection>
Common patterns:

- Require PR reviews: `required_pull_request_reviews: { required_approving_review_count: 1 }`
- Require status checks: `required_status_checks: { strict: true, contexts: ["ci/build"] }`
- Enforce for admins: `enforce_admins: true`
- Always check current protection with get_branch_protection before modifying.
  </branch_protection>
