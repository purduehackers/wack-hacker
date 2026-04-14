---
name: webhooks
description: List, create, edit, and delete webhooks.
criteria: Use when the user wants to manage webhooks — listing, creating, editing, moving, or deleting them.
tools: [list_webhooks, create_webhook, delete_webhook, edit_webhook]
minRole: organizer
mode: inline
---

<listing>
- Can filter by channel_id or return all server webhooks.
- Webhook URLs are sensitive — they allow posting without authentication.
</listing>

<creating>
- Requires a channel_id and name. Avatar is optional.
- Resolve the channel name to an ID via list_channels first.
- Only text-based channels support webhooks.
</creating>

<editing>
- Can change the name, avatar, or target channel.
- Only modify the fields the user asked to change.
</editing>

<deleting>
- Confirm before deleting — integrations using the webhook URL will break.
</deleting>
