---
description: Runtime logs, log/data drains, API Observability settings, and team audit events.
---

## When to use

Use when the user asks about runtime logs, where logs are exported (log drains / data drains), API Observability settings, or the team's audit/activity events.

## Relevant tools

`get_runtime_logs`, `list_log_drains`, `get_log_drain`, `delete_configurable_log_drain`, `list_integration_log_drains`, `delete_integration_log_drain`, `list_drains`, `get_drain`, `delete_drain`, `get_observability_config`, `update_observability_config`, `list_user_events`, `list_event_types`

## Instructions

<runtime-logs>
- get_runtime_logs pulls recent runtime logs for a deployment/project.
</runtime-logs>

<drains>
- Drains forward logs/events to an external destination. Three flavours:
  - Configurable log drains: list_log_drains / get_log_drain / delete_configurable_log_drain.
  - Integration log drains (created by installed integrations): list_integration_log_drains / delete_integration_log_drain.
  - Data drains (newer API, any event stream): list_drains / get_drain / delete_drain.
- Every delete_* here is destructive and prompts for confirmation — pass the exact drain id.
</drains>

<observability-config>
- get_observability_config reads the team's API Observability configuration.
- update_observability_config toggles API Observability Plus (enabled/disabled) for a project.
</observability-config>

<audit-events>
- list_user_events returns the team's audit/activity events; list_event_types lists the event types you can filter on.
</audit-events>
