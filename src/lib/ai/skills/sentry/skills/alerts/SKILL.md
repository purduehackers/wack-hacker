---
name: alerts
description: List, create, update, and delete issue and metric alert rules.
criteria: Use when the user wants to view, create, modify, or delete alert rules or notification triggers.
tools:
  [
    list_alert_rules,
    get_alert_rule,
    create_alert_rule,
    update_alert_rule,
    delete_alert_rule,
    list_metric_alert_rules,
    get_metric_alert_rule,
  ]
minRole: organizer
mode: inline
---

<issue_alerts>

- Issue alert rules trigger on individual events (e.g., new issue, regression, high frequency).
- list_alert_rules and get_alert_rule operate per-project.
- create_alert_rule requires: project slug, name, conditions, actions, and frequency.
- Common conditions: "A new issue is created", "An event is seen more than {value} times in {interval}".
- Common actions: "Send a notification to {service}" (Slack, email, PagerDuty).
  </issue_alerts>

<metric_alerts>

- Metric alert rules trigger on aggregate data (error count, latency percentiles, crash rate).
- list_metric_alert_rules and get_metric_alert_rule are org-level.
- These are more complex; prefer viewing over creation unless the user provides detailed config.
  </metric_alerts>

<deleting>
- delete_alert_rule is irreversible. Requires explicit user intent.
</deleting>
