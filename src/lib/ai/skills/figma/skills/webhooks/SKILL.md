---
name: webhooks
description: List, create, update, and delete team webhooks.
criteria: Use when the user asks about Figma webhooks, event subscriptions, or automated notifications from Figma.
tools: [list_team_webhooks, create_webhook, get_webhook, update_webhook, delete_webhook]
minRole: admin
mode: inline
---

<listing>
- list_team_webhooks returns all webhooks configured for the team.
- get_webhook returns details for a specific webhook by ID.
</listing>

<creating>
- create_webhook requires event_type, team_id, endpoint (callback URL), and optionally passcode and description.
- Event types include: FILE_UPDATE, FILE_DELETE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, and more.
</creating>

<managing>
- update_webhook can change the endpoint, passcode, description, or status (ACTIVE/PAUSED).
- delete_webhook removes a webhook permanently.
- Always confirm before deleting or creating webhooks.
</managing>
