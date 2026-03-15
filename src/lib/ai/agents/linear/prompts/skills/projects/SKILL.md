---
name: projects
description: Create/update projects and milestones; query project activity/history.
criteria: Use when the user wants to create/update a project, manage milestones, or inspect project history.
tools: create_project, update_project, create_project_milestone, update_project_milestone, query_project_activity, query_project_view
---

<creating_updating>

- Only populate fields the user provided; don't invent scope, timelines, or owners.
- If the user says "description" ambiguously, interpret whether they mean short summary vs long-form content based on length/format.
- teamIds is required for creation. Resolve via suggest_property_values(field: "Issue.teamId").
- Project states: planned, started, paused, completed, canceled.
- Links should be relevant and minimal (spec doc, PRD, dashboard).
  </creating_updating>

<milestones>
- Must be attached to a specific project; if unclear, ask which project.
- Only create milestones the user explicitly requests; don't infer phases.
- When updating, change only requested attributes; clear target date with null only when asked.
</milestones>

<activity>
- Use history to answer "when did status/lead/dates change?"
- Use updates to gather narrative progress; use comments when you need stakeholder discussion.
- Supports pagination and date ranges.
</activity>
