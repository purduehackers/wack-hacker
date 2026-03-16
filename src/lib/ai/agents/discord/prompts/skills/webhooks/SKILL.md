---
name: webhooks
description: List, create, edit, and delete webhooks.
criteria: Use when the user wants to manage webhooks — listing, creating, editing, moving, or deleting them.
tools: list_webhooks, create_webhook, delete_webhook, edit_webhook
---

<listing>
- list_webhooks can filter by channel_id or return all server webhooks.
- Each webhook has an id, name, channel, URL, and avatar.
- Webhook URLs are sensitive — they allow posting to the channel without authentication.
</listing>

<creating>
- Requires a channel_id and name. Avatar is optional.
- Resolve the channel name to an ID via list_channels first.
- The webhook URL is returned in the response — share it carefully.
- Only text-based channels support webhooks.
</creating>

<editing>
- edit_webhook can change the name, avatar, or target channel.
- Moving a webhook to a different channel changes where its messages appear.
- Only modify the fields the user asked to change.
</editing>

<deleting>
- Confirm before deleting — any integrations using the webhook URL will break.
- Report the webhook name in confirmation, not just the ID.
</deleting>
