---
name: planning
description: Track a structured plan via todo_write
criteria: Use when the task has 3 or more meaningful, independently verifiable steps, or when you need to keep yourself honest across many tool calls
tools: [todo_write]
minRole: admin
mode: inline
---

<when-to-use>
- Multi-step refactors.
- Features that touch more than one file.
- Any task where you've caught yourself losing track of what's done vs. what's left.
</when-to-use>

<when-to-skip>
- Single-file fixes.
- Trivial one-line changes.
- Tasks a single tool call can close out.
</when-to-skip>

<rules>
- Pass the FULL list on every call — `todo_write` replaces the previous list. It does not merge.
- Exactly ONE todo should be `in_progress` at a time.
- Mark todos `completed` immediately after finishing — don't batch.
- Use clear, short `content` — you'll re-read them later.
</rules>

<example>
```
{
  "todos": [
    {"id": "1", "content": "Read existing auth handler", "status": "completed"},
    {"id": "2", "content": "Add redirect-URL validation", "status": "in_progress"},
    {"id": "3", "content": "Run checks", "status": "todo"}
  ]
}
```
</example>
