---
name: artifacts
description: Inspect the Turborepo remote cache — status, artifact existence, and usage.
criteria: Use when the user asks about the Turborepo remote cache, build artifacts, cache hits/usage, or whether a specific artifact hash is cached.
tools: [artifacts_status, artifact_exists, artifact_query]
minRole: organizer
mode: inline
---

<remote-cache>
- artifacts_status reports whether the Turborepo remote cache is enabled and the team's usage.
- artifact_exists checks whether an artifact with a given hash is cached (a HEAD-style probe).
- artifact_query returns artifact events and usage statistics for one or more hashes.
</remote-cache>
