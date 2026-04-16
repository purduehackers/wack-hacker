---
name: issue-management
description: Update, resolve, ignore, assign, merge, and tag issues.
criteria: Use when the user wants to resolve, ignore, assign, merge, delete issues, or inspect issue tags.
tools: [update_issue, delete_issue, bulk_update_issues, list_issue_tags, get_issue_tag_values]
minRole: organizer
mode: inline
---

<resolving>
- update_issue with status "resolved" to resolve. Include status_details for resolve conditions:
  - `{ "inRelease": "latest" }` — resolve in latest release
  - `{ "inNextRelease": true }` — resolve in next release
  - `{ "inCommit": { "commit": "sha", "repository": "org/repo" } }` — resolve in commit
</resolving>

<ignoring>
- update_issue with status "ignored". Optional status_details:
  - `{ "ignoreDuration": 30 }` — ignore for 30 minutes
  - `{ "ignoreCount": 100 }` — ignore until seen 100 more times
  - `{ "ignoreWindow": 60, "ignoreCount": 100 }` — 100 times in 60 minutes
</ignoring>

<assigning>
- update_issue with assigned_to: "username", "team:team-slug", or "" to unassign.
</assigning>

<bulk>
- bulk_update_issues can resolve, ignore, or assign multiple issues at once by ID list.
</bulk>

<tags>
- list_issue_tags shows tag key distribution (browser, os, environment, etc.).
- get_issue_tag_values drills into specific tag values and their counts.
</tags>
