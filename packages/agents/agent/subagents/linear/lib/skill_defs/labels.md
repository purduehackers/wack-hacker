---
description: List, create, update, and delete Linear issue labels.
---

## When to use

Use when the user wants to manage Linear labels — creating, renaming, recoloring, or deleting them, or scoping labels to a team.

## Relevant tools

`list_labels`, `get_label`, `create_label`, `update_label`, `delete_label`

## Instructions

- Colors are hex with a leading '#' (e.g. '#FF0000').
- Labels can be workspace-wide or team-scoped. Scope to a team by passing team_id on create.
- delete_label removes the label from all issues — always confirm first.
