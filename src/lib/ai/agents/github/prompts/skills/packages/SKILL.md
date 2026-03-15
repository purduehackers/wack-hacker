---
name: packages
description: List, inspect, and manage organization packages and their versions.
criteria: Use when the user wants to view, inspect, or manage GitHub Packages.
tools: list_packages, get_package, list_package_versions, delete_package_version
---

<packages>
- Packages are scoped to the purduehackers organization.
- Supported types: npm, maven, rubygems, docker, nuget, container.
- `list_packages` requires a `package_type` filter.
- `get_package` returns details for a specific package.
</packages>

<versions>
- `list_package_versions` shows all versions of a package.
- `delete_package_version` permanently removes a version. Requires approval.
- Deletion cannot be undone — confirm the version ID before proceeding.
</versions>
