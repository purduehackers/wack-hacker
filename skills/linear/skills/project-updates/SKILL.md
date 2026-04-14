---
name: project-updates
description: Query, create, and update project status updates.
criteria: Use when the user wants to post, edit, or read project status updates.
tools: [query_project_updates, create_project_update, update_project_update]
minRole: organizer
mode: inline
---

<querying>
- Pull recent updates first to match tone and avoid repeating old news.
</querying>

<drafting>
- Unless explicitly told "post it", draft first for review.
- Start with the most important outcome in one sentence.
- Call out notable shipped work and key decisions.
- Name real blockers/risks if present.
- Close with concrete next steps.
</drafting>

<health>
- onTrack: normal progress, no major risk.
- atRisk: credible risk, still recoverable.
- offTrack: major slip or blocker.
- Set based on evidence, not optimism.
</health>
