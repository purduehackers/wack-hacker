---
name: databases
description: Query database entries with filters/sorts; create and update databases.
criteria: Use when the user wants to query, filter, or sort database entries, or create/modify a database schema.
tools: [query_database, create_database, update_database]
minRole: organizer
mode: inline
---

<querying>
- Always retrieve_database first to understand the schema. Property names and types must match exactly.

Filter syntax — single property:
`{ "property": "Status", "status": { "equals": "In Progress" } }`

AND compound:
`{ "and": [{ "property": "Status", "status": { "equals": "Done" } }, { "property": "Priority", "select": { "equals": "High" } }] }`

OR compound:
`{ "or": [{ "property": "Status", "status": { "equals": "In Progress" } }, { "property": "Status", "status": { "equals": "Not Started" } }] }`

Filter operators by type:

- title/rich_text: equals, contains, starts_with, ends_with, is_empty, is_not_empty
- number: equals, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to
- select/status: equals, does_not_equal, is_empty, is_not_empty
- multi_select: contains, does_not_contain, is_empty, is_not_empty
- date: equals, before, after, on_or_before, on_or_after, past_week, past_month, next_week, next_month
- checkbox: equals, does_not_equal
- people/relation: contains, does_not_contain, is_empty, is_not_empty

Sort syntax: `[{ "property": "Created", "direction": "descending" }]`
</querying>

<creating>
- Databases must have a parent page.
- Every database needs at least a title property: `{ "Name": { "title": {} } }`.
- Only include properties the user asked for.
</creating>

<updating>
- To add a property, include it in properties. To rename, use the property ID as key.
- To delete a property, set it to null.
</updating>
