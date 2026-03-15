---
name: issues
description: Create/update/delete issues; query issue activity/history.
criteria: Use when the user wants to create, update, delete, or inspect the history of a specific issue.
tools: create_issue, update_issue, delete_issue, query_issue_activity
---

<creating>
- One issue per call; prefer one-shot creation; avoid follow-up questions for optional fields.
- Title: short, single-line, 6-12 words; only backticks allowed as formatting.
- Description: factual, self-contained; only what's explicitly stated or strongly implied; no Discord thread metadata; avoid long quotes; don't prescribe approach.
- Prefer a single short paragraph unless the user provided structured info that benefits from bullets.
- If reproduction steps / expected vs actual / logs are provided, include them as-is (lightly cleaned up), but don't invent them.

<field_setting>

- Only set fields the user explicitly asked for or that are strongly implied (e.g., "make this urgent" -> priority Urgent).
- Team: if user names a team, set it; otherwise leave unset unless you need it to resolve team-scoped settings.
- Status:
  - Use a status type (triage/backlog/unstarted/started/completed/canceled) when exact workflow state name isn't specified.
  - "todo" -> status type unstarted.
  - If the issue has no clear owner (assignee/project/cycle), prefer triage so it shows up for review.
- Assignee:
  - ALWAYS assign to the requesting user by default. This is mandatory unless:
    - The user explicitly names someone else ("assign to Alice")
    - The user explicitly asks to leave it unassigned ("for the team to pick up", "put it in triage", "unassigned")
  - Resolve the requesting user's Linear account using `user.nickname` from execution context via `suggest_property_values` (field: "Issue.assigneeId", query: nickname). Try full nickname first, then first name only if no match.
  - Never skip assignee resolution. If you can't find the user, ask — don't leave unassigned silently.
- Project / milestone:
  - Set project when explicitly requested, or when the request is clearly about that project.
  - Only set a milestone if a project is set and the user asked for it.
- Due date: set only if the user asked. ISO 8601 format "YYYY-MM-DD".
- Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low.
- Relationships: only add relations if the user asked and you can resolve the referenced issues.
  - Use create_issue `relationships` or update_issue `issueRelations` with these semantic types:
    - `{ issueId: "<ID>", type: "isBlocking" }` — this issue blocks the referenced issue
    - `{ issueId: "<ID>", type: "isBlockedBy" }` — this issue is blocked by the referenced issue
    - `{ issueId: "<ID>", type: "isRelatedTo" }` — bidirectional relation
    - `{ issueId: "<ID>", type: "isDuplicateOf" }` — this issue is a duplicate of the referenced issue
    - `{ issueId: "<ID>", type: "isDuplicatedBy" }` — the referenced issue is a duplicate of this one
    - `{ issueId: "<ID>", type: "unrelatedTo" }` — remove all relations with the referenced issue
  - issueId accepts identifiers (e.g. "TEAM-123") or UUIDs.
  - To find issue IDs, use search_entities first. To see existing relations, use retrieve_entities (relations and inverseRelations are included).
- Parent / sub-issues: use `parentId` to make an issue a sub-issue of another. Set to null to clear.
- Customer request: create/attach when user explicitly frames it as customer feedback; ensure it maps to a specific customer.
  </field_setting>

<templates>
- Don't apply templates unless the user asks or there's a clearly relevant standard template.
- If a template is used, retrieve it first; replace placeholders with real values.
- For form templates, fill required fields via structured values; don't separately write a freeform description.
</templates>

<attachments>
- Only include attachments that add real context (screenshots, videos, logs).
- Each image/video/file reference goes in its own paragraph with a short caption.
- Put key links in the description; use attached links only for secondary references.
</attachments>
</creating>

<updating>
- Update only fields the user asks for; don't opportunistically "clean up" other fields.
- Description replaces the entire description; preserve existing text when "adding" something.
- Don't include Discord thread/channel IDs in descriptions.
- Use `issueRelations` to add/remove relations on existing issues (same semantic types as `relationships` on create).
- Use `parentId` to set/clear parent (sub-issue). Set to null to remove parent.
</updating>

<deleting>
- Only when explicitly asked.
- Only delete issues created by me earlier in this thread.
</deleting>

<activity>
- Use "history" when you need who/when of field changes; "comments" when you need discussion context.
- Supports pagination and date ranges for "what happened last week" type questions.
</activity>
