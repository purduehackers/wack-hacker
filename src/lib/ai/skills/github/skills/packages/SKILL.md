---
name: packages
description: List, inspect, and manage organization packages.
criteria: Use when the user wants to view, inspect, or manage GitHub Packages.
tools: [list_packages, get_package, list_package_versions, delete_package_version]
minRole: organizer
mode: inline
---

<packages>
- Scoped to the purduehackers organization.
- Supported types: npm, maven, rubygems, docker, nuget, container.
- list_packages requires a package_type filter.
</packages>

<versions>
- delete_package_version permanently removes a version. Requires approval.
- Deletion cannot be undone — confirm the version ID before proceeding.
</versions>
