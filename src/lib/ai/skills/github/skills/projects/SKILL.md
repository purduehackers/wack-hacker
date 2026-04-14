---
name: projects
description: Manage GitHub Projects v2 — list projects, view and manage items.
criteria: Use when the user wants to view or manage GitHub Projects, add items, or update fields.
tools:
  [
    list_org_projects,
    get_project,
    list_project_items,
    create_project_item,
    update_project_item,
    delete_project_item,
  ]
minRole: organizer
mode: inline
---

<projects>
- GitHub Projects v2 are organization-level planning boards.
- Identified by number (human-readable) and node ID (for mutations).
</projects>

<items>
- Items are issues or PRs added to a project.
- create_project_item adds by node ID. Search for the issue first if needed.
- update_project_item sets field values. Use get_project to find field IDs first.
- delete_project_item removes from project but doesn't delete the underlying issue/PR.
</items>

<field_values>

- Text: `{ text: "value" }`
- Number: `{ number: 42 }`
- Date: `{ date: "2025-12-31" }`
- Single select: `{ singleSelectOptionId: "option_id" }` — get IDs from get_project.
  </field_values>
