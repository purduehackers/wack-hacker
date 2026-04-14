---
name: project-views
description: Query and analyze project views in list or count mode, with filters.
criteria: Use for "show/count projects matching X".
tools: [query_project_view]
minRole: organizer
mode: inline
---

<views>
Available scopes: workspace (all projects), initiative-scoped, project label, custom view.
</views>

<list_mode>

- See individual projects with status/lead/health/priority. Supports pagination and ordering.
  </list_mode>

<count_mode>

- Fast totals: "how many active projects?" Use when only aggregate numbers needed.
  </count_mode>
