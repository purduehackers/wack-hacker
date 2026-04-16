---
name: variables
description: Inspect and modify design variables and collections.
criteria: Use when the user asks about design variables, design tokens, variable collections, or wants to create/update/delete variables.
tools: [get_local_variables, get_published_variables, modify_variables]
minRole: organizer
mode: inline
---

<reading>
- get_local_variables returns all variables and collections in a file (including unpublished).
- get_published_variables returns only published variables visible to consumers.
- Variables have modes (e.g., Light/Dark) with per-mode values.
- Variable types: COLOR, FLOAT, STRING, BOOLEAN.
</reading>

<modifying>
- modify_variables is a bulk operation that can create, update, and delete variables and collections in a single call.
- The request body contains optional arrays using the tool's input keys: variable_collections, variables, variable_modes.
- Each entry specifies an action: "CREATE", "UPDATE", or "DELETE".
- Always read current variables first before modifying.
- Only modify when the user explicitly asks.
</modifying>
