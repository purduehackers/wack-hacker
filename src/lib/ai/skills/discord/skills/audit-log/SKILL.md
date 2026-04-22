---
name: audit-log
description: View the Discord server audit log — who performed admin actions.
criteria: Use when the user wants to investigate recent moderation/admin actions, see who changed what, or audit server activity.
tools: [get_audit_log]
minRole: organizer
mode: inline
---

- Returns entries with action_type, executor (user_id or resolved name), target_id, reason, and field changes.
- Action type is a numeric enum (Discord's AuditLogEvent). Common types: 22=member_ban_add, 23=member_ban_remove, 24=member_update, 10=channel_create, 12=channel_delete, 30=role_create, 32=role_delete.
- Filter by user_id to see everything a specific user did, or by action_type to focus on a category.
- Paginate with before/after (entry IDs are snowflakes).
- Entries older than 45 days are discarded by Discord.
