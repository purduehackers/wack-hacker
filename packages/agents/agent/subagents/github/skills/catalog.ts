import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type LegacySkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const GITHUB_BASE_TOOL_NAMES = [
  "list_repositories",
  "get_repository",
  "search_code",
  "search_issues",
] as const;

export const GITHUB_SKILL_DEFINITIONS = [
  {
    name: "actions",
    description: "List and manage workflows, workflow runs, jobs, and artifacts.",
    criteria:
      "Use when the user wants to check CI/CD status, trigger workflows, view build logs, or manage runs.",
    minRole: "organizer",
    tools: [
      "list_workflows",
      "list_workflow_runs",
      "get_workflow_run",
      "trigger_workflow",
      "cancel_workflow_run",
      "rerun_workflow",
      "list_workflow_jobs",
      "download_artifact",
    ],
    instructions:
      '<workflows>\n- list_workflows shows all definitions. Identified by ID or filename (e.g., "ci.yml").\n</workflows>\n\n<runs>\n- list_workflow_runs can filter by workflow, branch, and status.\n- Status values: "completed", "in_progress", "queued", "failure", "success".\n</runs>\n\n<triggering>\n- trigger_workflow dispatches a workflow_dispatch event. Requires approval.\n- Workflow must have `on: workflow_dispatch` in its YAML.\n- Specify ref (branch/tag) and optional inputs.\n</triggering>\n\n<jobs>\n- list_workflow_jobs shows individual jobs within a run, including step-level status.\n</jobs>\n\n<artifacts>\n- download_artifact returns a download URL. Artifacts are zip files.\n</artifacts>',
  },
  {
    name: "collaborators",
    description:
      "Manage direct repository collaborators and pending invitations (admin only for writes).",
    criteria:
      "Use when the user wants to list repo collaborators, add/remove one, or manage pending repo invitations.",
    minRole: "admin",
    tools: [
      "list_collaborators",
      "add_collaborator",
      "remove_collaborator",
      "list_repo_invitations",
      "cancel_repo_invitation",
    ],
    instructions:
      "- Direct collaborators have access to a single repo; this is separate from org membership.\n- Permission levels: pull (read), triage, push (write, default), maintain, admin.\n- add_collaborator may trigger an invitation if the user isn't already in the org.\n- Always confirm with the user before remove_collaborator or cancel_repo_invitation.",
  },
  {
    name: "contents",
    description: "Read and write file contents; browse directory trees; view commits and diffs.",
    criteria:
      "Use when the user wants to read files, browse code, edit files, view commits, or compare branches.",
    minRole: "organizer",
    tools: [
      "get_file_content",
      "create_or_update_file",
      "delete_file",
      "get_directory_tree",
      "list_commits",
      "get_commit",
      "compare_commits",
    ],
    instructions:
      "<reading>\n- get_file_content returns decoded content. For large files (>50KB), content is truncated.\n- Use ref parameter to read from a specific branch/tag/SHA.\n- get_directory_tree returns the full recursive tree.\n</reading>\n\n<writing>\n- For updates, you MUST provide the sha of the existing file. Get it via get_file_content first.\n- Always provide a clear, descriptive commit message.\n- Specify branch to commit to a non-default branch.\n</writing>\n\n<deleting>\n- File deletion requires approval and the file's SHA.\n</deleting>\n\n<commits>\n- list_commits supports filtering by path, date range, and branch.\n- compare_commits compares two branches/tags/SHAs and shows the diff summary.\n</commits>",
  },
  {
    name: "deployments",
    description: "Manage deployments, deployment statuses, and GitHub Pages.",
    criteria:
      "Use when the user wants to view or create deployments, check deployment status, or manage GitHub Pages.",
    minRole: "organizer",
    tools: [
      "list_deployments",
      "create_deployment",
      "create_deployment_status",
      "get_pages_info",
      "list_pages_builds",
      "trigger_pages_build",
    ],
    instructions:
      '<deployments>\n- list_deployments can filter by environment and ref.\n- create_deployment requires approval since it can trigger production changes.\n- Common environments: "production", "staging", "preview".\n- After creating, update status with create_deployment_status.\n</deployments>\n\n<deployment_statuses>\n\n- States: "pending", "queued", "in_progress", "success", "failure", "error", "inactive".\n  </deployment_statuses>\n\n<pages>\n- get_pages_info shows Pages configuration. list_pages_builds shows build history.\n- trigger_pages_build requests a new build.\n</pages>',
  },
  {
    name: "environments",
    description:
      "Manage deployment environments — protection rules, wait timers, required reviewers.",
    criteria:
      "Use when the user wants to create/update/delete a deployment environment or view its protection rules.",
    minRole: "organizer",
    tools: [
      "list_environments",
      "get_environment",
      "create_or_update_environment",
      "delete_environment",
    ],
    instructions:
      "- Environments gate deployments with wait timers, required reviewers, and branch restrictions.\n- reviewers is an array of `{ type: 'User' | 'Team', id: number }` — resolve team IDs via list_teams.\n- deployment_branch_policy controls which branches can deploy: protected_branches, custom_branch_policies, or both false to allow all.\n- Delete confirmation required — deployments lose their environment association.",
  },
  {
    name: "issues",
    description: "Create, update, and manage issues; manage labels and milestones.",
    criteria:
      "Use when the user wants to create, update, close, or manage issues, labels, or milestones.",
    minRole: "organizer",
    tools: [
      "create_issue",
      "update_issue",
      "lock_issue",
      "unlock_issue",
      "add_assignees",
      "remove_assignees",
      "list_issue_comments",
      "create_issue_comment",
      "update_issue_comment",
      "delete_issue_comment",
      "manage_labels",
      "manage_milestones",
    ],
    instructions:
      '<creating>\n- Title: short, descriptive, 6-12 words.\n- Body: factual, self-contained Markdown.\n- Only set assignees, labels, and milestones when asked or strongly implied.\n</creating>\n\n<updating>\n- Only change fields the user asks for.\n- "Close" -> state "closed". "Reopen" -> state "open".\n- Body replaces the entire body — preserve existing content when "adding".\n</updating>\n\n<comments>\n- list_issue_comments to view existing discussion before commenting.\n- Comment body should be Markdown.\n</comments>\n\n<labels>\n- manage_labels with action "create", "update", or "delete".\n- Colors are hex without # (e.g., "ff0000").\n</labels>\n\n<milestones>\n- manage_milestones to create, update, or delete. Due dates in ISO 8601.\n</milestones>',
  },
  {
    name: "membership",
    description:
      "Invite or remove members from the purduehackers GitHub organization (admin only).",
    criteria:
      "Use when the user wants to add a new member to the GitHub organization or remove an existing member.",
    minRole: "admin",
    tools: ["add_member_to_platform", "remove_member_from_platform"],
    instructions:
      "<adding>\n- add_member_to_platform invites a GitHub user by username. Role defaults to 'member'; use 'admin' only when explicitly asked.\n- Confirm the exact GitHub username with the user — do not guess.\n- If the user already exists in the org, the call updates their role instead.\n- State returns as 'active' (already a member) or 'pending' (invite sent, awaiting acceptance).\n</adding>\n\n<removing>\n- remove_member_from_platform revokes the user's organization membership and all repo access.\n- Confirm with the user before calling — this is destructive and not reversible without reinviting.\n- The user's GitHub account is not affected; only their org membership is removed.\n</removing>",
  },
  {
    name: "organization",
    description: "View organization members and teams; manage team membership and webhooks.",
    criteria:
      "Use when the user wants to view org members, teams, manage membership, or manage webhooks.",
    minRole: "organizer",
    tools: [
      "list_org_members",
      "get_org_member",
      "list_teams",
      "get_team",
      "list_team_members",
      "invite_org_member",
      "remove_org_member",
      "add_team_member",
      "remove_team_member",
      "list_repo_webhooks",
      "create_webhook",
      "update_webhook",
      "delete_webhook",
      "list_org_webhooks",
    ],
    instructions:
      '<members>\n- list_org_members with optional role filter ("admin", "member", "all").\n- get_org_member returns membership details.\n</members>\n\n<teams>\n- Teams are identified by slug, not name.\n- list_team_members with optional role filter.\n</teams>\n\n<webhooks>\n- Always specify events to subscribe to (e.g., ["push", "pull_request"]).\n- Use content_type: "json" unless specified otherwise.\n- Include a secret for signature verification when possible.\n- Deleting a webhook requires approval.\n</webhooks>',
  },
  {
    name: "packages",
    description: "List, inspect, and manage organization packages.",
    criteria: "Use when the user wants to view, inspect, or manage GitHub Packages.",
    minRole: "organizer",
    tools: ["list_packages", "get_package", "list_package_versions", "delete_package_version"],
    instructions:
      "<packages>\n- Scoped to the purduehackers organization.\n- Supported types: npm, maven, rubygems, docker, nuget, container.\n- list_packages requires a package_type filter.\n</packages>\n\n<versions>\n- delete_package_version permanently removes a version. Requires approval.\n- Deletion cannot be undone — confirm the version ID before proceeding.\n</versions>",
  },
  {
    name: "projects",
    description: "Manage GitHub Projects v2 — list projects, view and manage items.",
    criteria:
      "Use when the user wants to view or manage GitHub Projects, add items, or update fields.",
    minRole: "organizer",
    tools: [
      "list_org_projects",
      "get_project",
      "list_project_items",
      "create_project_item",
      "update_project_item",
      "delete_project_item",
    ],
    instructions:
      '<projects>\n- GitHub Projects v2 are organization-level planning boards.\n- Identified by number (human-readable) and node ID (for mutations).\n</projects>\n\n<items>\n- Items are issues or PRs added to a project.\n- create_project_item adds by node ID. Search for the issue first if needed.\n- update_project_item sets field values. Use get_project to find field IDs first.\n- delete_project_item removes from project but doesn\'t delete the underlying issue/PR.\n</items>\n\n<field_values>\n\n- Text: `{ text: "value" }`\n- Number: `{ number: 42 }`\n- Date: `{ date: "2025-12-31" }`\n- Single select: `{ singleSelectOptionId: "option_id" }` — get IDs from get_project.\n  </field_values>',
  },
  {
    name: "pull-requests",
    description: "Create, update, review, and merge pull requests.",
    criteria: "Use when the user wants to create, update, review, merge, or inspect pull requests.",
    minRole: "organizer",
    tools: [
      "create_pull_request",
      "update_pull_request",
      "merge_pull_request",
      "close_pull_request",
      "request_reviewers",
      "remove_requested_reviewers",
      "list_pr_reviews",
      "create_pr_review",
      "list_pr_files",
      "list_pr_comments",
    ],
    instructions:
      '<creating>\n- Always specify head (source) and base (target) branches.\n- Default base branch is the repo\'s default branch.\n- Set `draft: true` for WIP/draft PRs.\n</creating>\n\n<merging>\n- Requires approval (Approve/Deny button).\n- Default merge method is "squash" unless specified otherwise.\n- Consider checking reviews and changed files before merging.\n</merging>\n\n<reviews>\n- create_pr_review to approve, request changes, or comment.\n- Event types: "APPROVE", "REQUEST_CHANGES", "COMMENT".\n</reviews>\n\n<inspection>\n- list_pr_files shows changed files with additions/deletions and patch snippet.\n- list_pr_reviews shows review history.\n- list_pr_comments shows inline review comments.\n</inspection>',
  },
  {
    name: "reactions",
    description: "Add or remove reaction emojis on issues and issue/PR comments.",
    criteria:
      "Use when the user wants to react to an issue or comment with an emoji, or remove a reaction.",
    minRole: "organizer",
    tools: [
      "add_issue_reaction",
      "remove_issue_reaction",
      "add_comment_reaction",
      "remove_comment_reaction",
    ],
    instructions:
      "- Supported reactions: +1, -1, laugh, confused, heart, hooray, rocket, eyes.\n- add_issue_reaction and add_comment_reaction return a reaction_id; save it to remove the reaction later.\n- Remove calls require the reaction_id (the one returned when adding).",
  },
  {
    name: "releases",
    description:
      "Manage GitHub releases — list, create, update, and delete releases and their assets.",
    criteria:
      "Use when the user wants to list, view, create, update, or delete a GitHub release, or inspect its assets.",
    minRole: "organizer",
    tools: [
      "list_releases",
      "get_release",
      "create_release",
      "update_release",
      "delete_release",
      "list_release_assets",
    ],
    instructions:
      "- Releases are tied to git tags. create_release auto-creates the tag if target_commitish is provided.\n- Use generate_release_notes:true to auto-populate the body from PRs merged since the previous release.\n- Drafts are not visible to non-collaborators; publish by updating draft:false.\n- Prereleases are visible but marked as not-production-ready.\n- delete_release does NOT delete the underlying tag — use delete_ref in tags-refs to remove the tag.",
  },
  {
    name: "repositories",
    description: "Create, update, and delete repositories; manage branches and branch protection.",
    criteria:
      "Use when the user wants to manage repository settings, branches, or branch protection.",
    minRole: "organizer",
    tools: [
      "create_repository",
      "update_repository",
      "delete_repository",
      "archive_repository",
      "transfer_repository",
      "list_branches",
      "get_branch_protection",
      "set_branch_protection",
      "delete_branch_protection",
    ],
    instructions:
      '<creating>\n- New repos default to private. Only set public if explicitly requested.\n- Initialize with README (auto_init: true) unless told otherwise.\n</creating>\n\n<updating>\n- Only change settings explicitly asked for.\n- Archiving and visibility changes require confirmation.\n</updating>\n\n<deleting>\n- Deletion is irreversible and requires approval.\n</deleting>\n\n<branch_protection>\nCommon patterns:\n\n- Require PR reviews: `required_pull_request_reviews: { required_approving_review_count: 1 }`\n- Require status checks: `required_status_checks: { strict: true, contexts: ["ci/build"] }`\n- Enforce for admins: `enforce_admins: true`\n- Always check current protection with get_branch_protection before modifying.\n  </branch_protection>',
  },
  {
    name: "secrets-and-variables",
    description: "Manage repository and organization secrets and variables for GitHub Actions.",
    criteria: "Use when the user wants to view, create, update, or delete secrets or variables.",
    minRole: "organizer",
    tools: [
      "list_repo_secrets",
      "create_or_update_repo_secret",
      "delete_repo_secret",
      "list_repo_variables",
      "create_or_update_repo_variable",
      "delete_repo_variable",
      "list_org_secrets",
      "create_or_update_org_secret",
      "delete_org_secret",
      "list_org_variables",
      "create_or_update_org_variable",
      "delete_org_variable",
    ],
    instructions:
      '<secrets>\n- Values are encrypted and write-only — you can list names but never read values.\n- Encryption is handled automatically by the tools.\n- Org secrets have visibility scopes: "all", "private", or "selected".\n- Deleting requires approval.\n</secrets>\n\n<variables>\n- Variables are readable, unlike secrets. Use for non-sensitive configuration.\n- create_or_update creates if nonexistent, updates if it does.\n- Org variables also have visibility scopes.\n</variables>\n\n<guidance>\n- "env var" or "config" -> clarify whether they mean secret (sensitive) or variable (non-sensitive).\n- API keys, tokens, passwords -> always use secrets.\n- Feature flags, URLs, environment names -> use variables.\n</guidance>',
  },
  {
    name: "tags-refs",
    description: "Manage git refs (branches and tags) — list, create, update, and delete.",
    criteria:
      "Use when the user wants to create/delete a branch or tag, or inspect refs via the git plumbing API.",
    minRole: "organizer",
    tools: ["list_tags", "list_refs", "get_ref", "create_ref", "update_ref", "delete_ref"],
    instructions:
      "- create_ref expects the full ref with `refs/` prefix (e.g. 'refs/heads/new-branch').\n- update_ref and delete_ref expect the path WITHOUT `refs/` (e.g. 'heads/main').\n- Force-update a branch with update_ref force:true (effectively a force-push).\n- delete_ref on 'heads/main' (or any default branch) will fail — GitHub requires changing the default first.",
  },
] as const satisfies readonly LegacySkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, GITHUB_SKILL_DEFINITIONS),
  },
});
