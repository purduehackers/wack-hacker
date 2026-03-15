---
name: issues
description: Create, update, and manage issues; manage labels and milestones.
criteria: Use when the user wants to create, update, close, or manage issues, labels, or milestones.
tools: create_issue, update_issue, list_issue_comments, create_issue_comment, update_issue_comment, delete_issue_comment, manage_labels, manage_milestones
---

<creating>
- Title: short, descriptive, 6-12 words.
- Body: factual, self-contained Markdown. Only include what's explicitly stated or strongly implied.
- Only set assignees, labels, and milestones when the user asks for them or they're strongly implied.
- If the user says "assign to me", ask for their GitHub username if you don't know it.
</creating>

<updating>
- Only change fields the user asks for.
- "Close" → set state to "closed".
- "Reopen" → set state to "open".
- Body replaces the entire body — preserve existing content when "adding" something.
</updating>

<comments>
- Use `list_issue_comments` to view existing discussion before commenting.
- Comment body should be Markdown.
</comments>

<labels>
- Use `manage_labels` with action "create", "update", or "delete".
- Colors are hex without # (e.g., "ff0000" for red).
- Check existing labels with `search_issues` before creating duplicates.
</labels>

<milestones>
- Use `manage_milestones` to create, update, or delete milestones.
- Due dates are ISO 8601 format.
</milestones>
