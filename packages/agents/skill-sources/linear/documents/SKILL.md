---
name: documents
description: Create and update documents attached to a project, initiative, issue, or cycle.
criteria: Use when the user wants to create or update a document.
tools: [create_document, update_document]
minRole: organizer
mode: inline
---

Documents attach to exactly one parent (project, initiative, issue, or cycle).

<creating>
- Preserve user-provided content verbatim unless asked to rewrite.
- If parent isn't specified, ask rather than guessing.
- Resolve parent entity ID via suggest_property_values or search_entities.
</creating>

<updating>
- Apply the minimal requested edits. Don't "refactor" wording unless asked.
- Can move to a different parent if requested.
</updating>
