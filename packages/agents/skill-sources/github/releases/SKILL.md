---
name: releases
description: Manage GitHub releases — list, create, update, and delete releases and their assets.
criteria: Use when the user wants to list, view, create, update, or delete a GitHub release, or inspect its assets.
tools:
  [list_releases, get_release, create_release, update_release, delete_release, list_release_assets]
minRole: organizer
mode: inline
---

- Releases are tied to git tags. create_release auto-creates the tag if target_commitish is provided.
- Use generate_release_notes:true to auto-populate the body from PRs merged since the previous release.
- Drafts are not visible to non-collaborators; publish by updating draft:false.
- Prereleases are visible but marked as not-production-ready.
- delete_release does NOT delete the underlying tag — use delete_ref in tags-refs to remove the tag.
