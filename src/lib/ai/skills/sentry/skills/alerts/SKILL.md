---
name: alerts
description: Create, update, and manage Sentry alert rules for projects.
criteria: Use when the user wants to list, create, modify, or delete alert rules or notifications.
tools:
  [
    list_sentry_alert_rules,
    get_sentry_alert_rule,
    create_sentry_alert_rule,
    update_sentry_alert_rule,
    delete_sentry_alert_rule,
  ]
minRole: organizer
mode: inline
---

<listing>
- Use `list_sentry_alert_rules` to see all issue alert rules for a project.
- Each rule has conditions (when to trigger), filters (what to match), and actions (what to do).
</listing>

<creating>
- Use `create_sentry_alert_rule` with:
  - `actionMatch`: "all", "any", or "none" — how conditions combine.
  - `conditions`: trigger conditions (e.g. first seen, regression, event frequency).
  - `actions`: notification targets (e.g. send email, post to Slack).
  - `filters`: optional narrowing (e.g. specific error level, tag match).
  - `frequency`: minimum minutes between alerts.
- Always confirm the rule configuration with the user before creating.
</creating>

<updating>
- Use `update_sentry_alert_rule` to modify any field.
- Retrieve the current rule first with `get_sentry_alert_rule` to understand existing config.
</updating>

<deleting>
- `delete_sentry_alert_rule` permanently removes a rule. Admin role required.
</deleting>
