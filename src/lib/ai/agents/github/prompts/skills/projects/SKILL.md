---
name: projects
description: Manage GitHub Projects v2 — list projects, view and manage project items.
criteria: Use when the user wants to view or manage GitHub Projects, add items to projects, or update project fields.
tools: list_org_projects, get_project, list_project_items, create_project_item, update_project_item, delete_project_item
---

<projects>
- GitHub Projects v2 are organization-level planning boards.
- `list_org_projects` returns projects with their node IDs and numbers.
- `get_project` returns full details including fields (columns/properties).
- Projects are identified by number (human-readable) and node ID (for mutations).
</projects>

<items>
- Items are issues or pull requests added to a project.
- `list_project_items` shows items with their field values (status, assignee, etc.).
- `create_project_item` adds an issue/PR by its node ID. To get the node ID, you may need to search for the issue first.
- `update_project_item` sets a field value on an item. Use `get_project` to find field IDs first.
- `delete_project_item` removes an item from the project (does not delete the underlying issue/PR).
</items>

<field_values>
When updating project item fields:

- Text fields: `{ text: "value" }`
- Number fields: `{ number: 42 }`
- Date fields: `{ date: "2025-12-31" }`
- Single select fields: `{ singleSelectOptionId: "option_id" }` — get option IDs from `get_project` field definitions.
  </field_values>
