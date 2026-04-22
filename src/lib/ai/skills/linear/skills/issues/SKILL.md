---
name: issues
description: Create, update, delete issues; query issue activity and history.
criteria: Use when the user wants to create, update, delete, or inspect the history of a specific issue.
tools:
  [create_issue, update_issue, delete_issue, archive_issue, unarchive_issue, query_issue_activity]
minRole: organizer
mode: inline
---

<creating>
- Title: short, single-line, 6-12 words. Only backticks allowed as formatting.
- Description: factual, self-contained. Only what's explicitly stated or strongly implied.
- ALWAYS assign to the requesting user by default unless they explicitly name someone else or ask to leave it unassigned.
- Resolve the requesting user via suggest_property_values (field: "Issue.assigneeId", query: nickname).
- Status types: triage, backlog, unstarted, started, completed, canceled.
- Priority: 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low.
- Only set fields the user explicitly asked for or that are strongly implied.
- Relationships: isBlocking, isBlockedBy, isRelatedTo, isDuplicateOf, isDuplicatedBy, unrelatedTo.
</creating>

<updating>
- Update only fields the user asks for. Don't opportunistically "clean up" other fields.
- Description replaces the entire description; preserve existing text when "adding" something.
</updating>

<deleting>
- Only when explicitly asked. Only delete issues created by me earlier in this thread.
- Prefer archive_issue over delete_issue — archive is reversible via unarchive_issue.
</deleting>

<activity>
- Use "history" for who/when of field changes; "comments" for discussion context.
- Supports pagination and date ranges.
</activity>
