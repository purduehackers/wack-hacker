---
name: databases
description: Query database entries with filters/sorts; create and update databases.
criteria: Use when the user wants to query, filter, or sort database entries, or create/modify a database schema.
tools: query_database, create_database, update_database
---

<querying>
- Always retrieve_database first to understand the schema before building filters. Property names and types must match exactly.
- Use query_database with filter and sorts parameters for structured queries.

<filter_syntax>
Filters use Notion's compound filter format:

Single property filter:

```json
{ "property": "Status", "status": { "equals": "In Progress" } }
```

AND compound:

```json
{
  "and": [
    { "property": "Status", "status": { "equals": "Done" } },
    { "property": "Priority", "select": { "equals": "High" } }
  ]
}
```

OR compound:

```json
{
  "or": [
    { "property": "Status", "status": { "equals": "In Progress" } },
    { "property": "Status", "status": { "equals": "Not Started" } }
  ]
}
```

Filter operators by property type:

- title/rich_text: equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty
- number: equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to, is_empty, is_not_empty
- select: equals, does_not_equal, is_empty, is_not_empty
- multi_select: contains, does_not_contain, is_empty, is_not_empty
- status: equals, does_not_equal, is_empty, is_not_empty
- date: equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty, past_week, past_month, past_year, next_week, next_month, next_year
- checkbox: equals, does_not_equal
- people: contains, does_not_contain, is_empty, is_not_empty
- relation: contains, does_not_contain, is_empty, is_not_empty
  </filter_syntax>

<sort_syntax>
Sorts are an array of sort objects:

```json
[
  { "property": "Created", "direction": "descending" },
  { "property": "Name", "direction": "ascending" }
]
```

Built-in sorts: `{ "timestamp": "created_time", "direction": "descending" }`.
</sort_syntax>

- Pagination: use start_cursor from the response's next_cursor to fetch the next page.
- Keep page_size reasonable (25-50). Only increase if the user needs all results.
  </querying>

<creating>
- Databases must have a parent page. Search for the parent first.
- Every database needs at least a title property: `{ "Name": { "title": {} } }`.
- Define the schema upfront. Common property types:
  - `{ "title": {} }` — title (required, exactly one)
  - `{ "rich_text": {} }` — text
  - `{ "number": { "format": "number" } }` — number (formats: number, number_with_commas, percent, dollar, euro, pound, yen, etc.)
  - `{ "select": { "options": [{ "name": "A" }, { "name": "B" }] } }` — single select
  - `{ "multi_select": { "options": [{ "name": "X" }, { "name": "Y" }] } }` — multi select
  - `{ "status": {} }` — status (Notion provides default groups)
  - `{ "date": {} }` — date
  - `{ "checkbox": {} }` — checkbox
  - `{ "people": {} }` — people
  - `{ "url": {} }` — URL
  - `{ "relation": { "database_id": "..." } }` — relation to another database
- Only include properties the user asked for. Don't add extras.
</creating>

<updating>
- Update title or property schema. To add a new property, include it in properties. To rename, use the property ID as the key with the new name.
- To delete a property, set it to null in the properties object.
- Schema changes affect all existing entries.
</updating>
