---
name: project-updates
description: Query, create, and update project updates (status/progress posts on projects).
criteria: Use when the user wants to post, edit, or read project status updates.
tools: query_project_updates, create_project_update, update_project_update
---

<querying>
- Pull recent updates first to match existing tone and avoid repeating old news.
- Use date ranges/pagination for "updates in the last month".
</querying>

<drafting>
- Unless explicitly told "post it", draft the update in chat first for review.
- Gather context from:
  - Last project update (tone + cutoff date)
  - Completed issues since last update (project-scoped, via aggregate_issues)
  - Project activity since last update (status/milestone/member changes)
- Structure (natural, not rigid):
  - Start with the most important outcome/decision in one sentence.
  - Call out notable shipped work and key decisions (not meeting-by-meeting narration).
  - Name real blockers/risks if present and what's being done (only if known).
  - Close with next steps that are concrete and near-term.
</drafting>

<health>
- onTrack: normal progress, no major risk.
- atRisk: credible risk or dependency, still recoverable.
- offTrack: major slip or blocker.
- Set based on evidence, not optimism.
</health>

<editing>
- Only update what the user asks; editing may be restricted to the original author/admins.
</editing>
