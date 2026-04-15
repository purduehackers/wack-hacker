---
name: releases
description: View Sentry releases, deploy history, and release health.
criteria: Use when the user wants to see releases, deployments, or what was shipped.
tools: [list_sentry_releases, get_sentry_release, list_sentry_deploys]
minRole: organizer
mode: inline
---

<listing>
- Use `list_sentry_releases` to see recent releases with new issue counts and commit info.
- Filter by project slug or search by version string.
</listing>

<details>
- Use `get_sentry_release` for full release details — commits, authors, deploy history, and associated projects.
- Use `list_sentry_deploys` to see where and when a release was deployed (environment, timestamps).
</details>
