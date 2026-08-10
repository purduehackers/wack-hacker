---
description: Manage git refs (branches and tags) — list, create, update, and delete.
---

## When to use

Use when the user wants to create/delete a branch or tag, or inspect refs via the git plumbing API.

## Relevant tools

`list_tags`, `list_refs`, `get_ref`, `create_ref`, `update_ref`, `delete_ref`

## Instructions

- create_ref expects the full ref with `refs/` prefix (e.g. 'refs/heads/new-branch').
- update_ref and delete_ref expect the path WITHOUT `refs/` (e.g. 'heads/main').
- Force-update a branch with update_ref force:true (effectively a force-push).
- delete_ref on 'heads/main' (or any default branch) will fail — GitHub requires changing the default first.
