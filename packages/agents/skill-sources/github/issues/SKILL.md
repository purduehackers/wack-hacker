---
name: issues
description: Create, update, and manage issues; manage labels and milestones.
criteria: Use when the user wants to create, update, close, or manage issues, labels, or milestones.
tools:
  [
    create_issue,
    update_issue,
    lock_issue,
    unlock_issue,
    add_assignees,
    remove_assignees,
    list_issue_comments,
    create_issue_comment,
    update_issue_comment,
    delete_issue_comment,
    manage_labels,
    manage_milestones,
  ]
minRole: organizer
mode: inline
---

<creating>
- Title: short, descriptive, 6-12 words.
- Body: factual, self-contained Markdown.
- Only set assignees, labels, and milestones when asked or strongly implied.
</creating>

<updating>
- Only change fields the user asks for.
- "Close" -> state "closed". "Reopen" -> state "open".
- Body replaces the entire body — preserve existing content when "adding".
</updating>

<comments>
- list_issue_comments to view existing discussion before commenting.
- Comment body should be Markdown.
</comments>

<labels>
- manage_labels with action "create", "update", or "delete".
- Colors are hex without # (e.g., "ff0000").
</labels>

<milestones>
- manage_milestones to create, update, or delete. Due dates in ISO 8601.
</milestones>
