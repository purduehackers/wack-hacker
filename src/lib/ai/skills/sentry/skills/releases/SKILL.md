---
name: releases
description: Create and manage releases and deploys; view release health and commits.
criteria: Use when the user wants to create releases, record deploys, view release health, or see release commits.
tools:
  [
    list_releases,
    get_release,
    create_release,
    list_release_deploys,
    create_deploy,
    list_release_commits,
  ]
minRole: organizer
mode: inline
---

<releases>
- Releases are identified by version string (e.g., "1.0.0", a commit SHA, or a semver tag).
- list_releases returns releases sorted by date. Filter by project if needed.
- create_release requires a version and at least one project slug.
</releases>

<deploys>
- create_deploy records a deployment for a release. Requires environment name (e.g., "production", "staging").
- Deploys track when a release was shipped to an environment.
</deploys>

<commits>
- list_release_commits shows commits associated with a release.
- Commits are typically set during release creation via refs or commit list.
</commits>
