---
name: projects
description: Create/update projects and milestones; query project activity.
criteria: Use when the user wants to create/update a project, manage milestones, or inspect project history.
tools:
  [
    create_project,
    update_project,
    get_project,
    archive_project,
    unarchive_project,
    delete_project,
    create_project_milestone,
    update_project_milestone,
    query_project_activity,
    query_project_view,
  ]
minRole: organizer
mode: inline
---

<creating_updating>

- Only populate fields the user provided. Don't invent scope, timelines, or owners.
- teamIds is required for creation. Resolve via suggest_property_values.
- Project states: planned, started, paused, completed, canceled.
  </creating_updating>

<milestones>
- Must be attached to a project. Only create milestones the user explicitly requests.
- Clear target date with null only when asked.
</milestones>

<activity>
- Use history for "when did status/lead/dates change?"
- Supports pagination and date ranges.
</activity>

<archiving>
- Prefer archive_project over delete_project — archive is reversible via unarchive_project.
- delete_project is permanent and only for mistaken creations.
</archiving>
