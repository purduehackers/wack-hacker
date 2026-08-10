import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import actionsDoc from "../lib/skill_defs/actions.md" with { type: "text" };
import collaboratorsDoc from "../lib/skill_defs/collaborators.md" with { type: "text" };
import contentsDoc from "../lib/skill_defs/contents.md" with { type: "text" };
import deploymentsDoc from "../lib/skill_defs/deployments.md" with { type: "text" };
import environmentsDoc from "../lib/skill_defs/environments.md" with { type: "text" };
import issuesDoc from "../lib/skill_defs/issues.md" with { type: "text" };
import membershipDoc from "../lib/skill_defs/membership.md" with { type: "text" };
import organizationDoc from "../lib/skill_defs/organization.md" with { type: "text" };
import packagesDoc from "../lib/skill_defs/packages.md" with { type: "text" };
import projectsDoc from "../lib/skill_defs/projects.md" with { type: "text" };
import pullRequestsDoc from "../lib/skill_defs/pull-requests.md" with { type: "text" };
import reactionsDoc from "../lib/skill_defs/reactions.md" with { type: "text" };
import releasesDoc from "../lib/skill_defs/releases.md" with { type: "text" };
import repositoriesDoc from "../lib/skill_defs/repositories.md" with { type: "text" };
import secretsAndVariablesDoc from "../lib/skill_defs/secrets-and-variables.md" with { type: "text" };
import tagsRefsDoc from "../lib/skill_defs/tags-refs.md" with { type: "text" };

export const GITHUB_BASE_TOOL_NAMES = [
  "list_repositories",
  "get_repository",
  "search_code",
  "search_issues",
] as const;

export const GITHUB_SKILL_DEFINITIONS = [
  {
    name: "actions",
    minRole: "organizer",
    doc: actionsDoc,
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
  },
  {
    name: "collaborators",
    minRole: "admin",
    doc: collaboratorsDoc,
    tools: [
      "list_collaborators",
      "add_collaborator",
      "remove_collaborator",
      "list_repo_invitations",
      "cancel_repo_invitation",
    ],
  },
  {
    name: "contents",
    minRole: "organizer",
    doc: contentsDoc,
    tools: [
      "get_file_content",
      "create_or_update_file",
      "delete_file",
      "get_directory_tree",
      "list_commits",
      "get_commit",
      "compare_commits",
    ],
  },
  {
    name: "deployments",
    minRole: "organizer",
    doc: deploymentsDoc,
    tools: [
      "list_deployments",
      "create_deployment",
      "create_deployment_status",
      "get_pages_info",
      "list_pages_builds",
      "trigger_pages_build",
    ],
  },
  {
    name: "environments",
    minRole: "organizer",
    doc: environmentsDoc,
    tools: [
      "list_environments",
      "get_environment",
      "create_or_update_environment",
      "delete_environment",
    ],
  },
  {
    name: "issues",
    minRole: "organizer",
    doc: issuesDoc,
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
  },
  {
    name: "membership",
    minRole: "admin",
    doc: membershipDoc,
    tools: ["add_member_to_platform", "remove_member_from_platform"],
  },
  {
    name: "organization",
    minRole: "organizer",
    doc: organizationDoc,
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
  },
  {
    name: "packages",
    minRole: "organizer",
    doc: packagesDoc,
    tools: ["list_packages", "get_package", "list_package_versions", "delete_package_version"],
  },
  {
    name: "projects",
    minRole: "organizer",
    doc: projectsDoc,
    tools: [
      "list_org_projects",
      "get_project",
      "list_project_items",
      "create_project_item",
      "update_project_item",
      "delete_project_item",
    ],
  },
  {
    name: "pull-requests",
    minRole: "organizer",
    doc: pullRequestsDoc,
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
  },
  {
    name: "reactions",
    minRole: "organizer",
    doc: reactionsDoc,
    tools: [
      "add_issue_reaction",
      "remove_issue_reaction",
      "add_comment_reaction",
      "remove_comment_reaction",
    ],
  },
  {
    name: "releases",
    minRole: "organizer",
    doc: releasesDoc,
    tools: [
      "list_releases",
      "get_release",
      "create_release",
      "update_release",
      "delete_release",
      "list_release_assets",
    ],
  },
  {
    name: "repositories",
    minRole: "organizer",
    doc: repositoriesDoc,
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
  },
  {
    name: "secrets-and-variables",
    minRole: "organizer",
    doc: secretsAndVariablesDoc,
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
  },
  {
    name: "tags-refs",
    minRole: "organizer",
    doc: tagsRefsDoc,
    tools: ["list_tags", "list_refs", "get_ref", "create_ref", "update_ref", "delete_ref"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, GITHUB_SKILL_DEFINITIONS),
  },
});
