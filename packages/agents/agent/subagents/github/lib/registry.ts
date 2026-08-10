/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them is how a domain this wide
 * grows tools no skill describes. `tool_defs/` mirrors the skill list exactly —
 * one directory per skill, one file per tool — and `check:capabilities` fails
 * if it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import actionsDoc from "./skill_defs/actions.md" with { type: "text" };
import collaboratorsDoc from "./skill_defs/collaborators.md" with { type: "text" };
import contentsDoc from "./skill_defs/contents.md" with { type: "text" };
import deploymentsDoc from "./skill_defs/deployments.md" with { type: "text" };
import environmentsDoc from "./skill_defs/environments.md" with { type: "text" };
import issuesDoc from "./skill_defs/issues.md" with { type: "text" };
import membershipDoc from "./skill_defs/membership.md" with { type: "text" };
import organizationDoc from "./skill_defs/organization.md" with { type: "text" };
import packagesDoc from "./skill_defs/packages.md" with { type: "text" };
import projectsDoc from "./skill_defs/projects.md" with { type: "text" };
import pullRequestsDoc from "./skill_defs/pull-requests.md" with { type: "text" };
import reactionsDoc from "./skill_defs/reactions.md" with { type: "text" };
import releasesDoc from "./skill_defs/releases.md" with { type: "text" };
import repositoriesDoc from "./skill_defs/repositories.md" with { type: "text" };
import secretsAndVariablesDoc from "./skill_defs/secrets-and-variables.md" with { type: "text" };
import tagsRefsDoc from "./skill_defs/tags-refs.md" with { type: "text" };
import { cancel_workflow_run } from "./tool_defs/actions/cancel_workflow_run.ts";
import { download_artifact } from "./tool_defs/actions/download_artifact.ts";
import { get_workflow_run } from "./tool_defs/actions/get_workflow_run.ts";
import { list_workflow_jobs } from "./tool_defs/actions/list_workflow_jobs.ts";
import { list_workflow_runs } from "./tool_defs/actions/list_workflow_runs.ts";
import { list_workflows } from "./tool_defs/actions/list_workflows.ts";
import { rerun_workflow } from "./tool_defs/actions/rerun_workflow.ts";
import { trigger_workflow } from "./tool_defs/actions/trigger_workflow.ts";
import { get_repository } from "./tool_defs/base/get_repository.ts";
import { list_repositories } from "./tool_defs/base/list_repositories.ts";
import { search_code } from "./tool_defs/base/search_code.ts";
import { search_issues } from "./tool_defs/base/search_issues.ts";
import { add_collaborator } from "./tool_defs/collaborators/add_collaborator.ts";
import { cancel_repo_invitation } from "./tool_defs/collaborators/cancel_repo_invitation.ts";
import { list_collaborators } from "./tool_defs/collaborators/list_collaborators.ts";
import { list_repo_invitations } from "./tool_defs/collaborators/list_repo_invitations.ts";
import { remove_collaborator } from "./tool_defs/collaborators/remove_collaborator.ts";
import { compare_commits } from "./tool_defs/contents/compare_commits.ts";
import { create_or_update_file } from "./tool_defs/contents/create_or_update_file.ts";
import { delete_file } from "./tool_defs/contents/delete_file.ts";
import { get_commit } from "./tool_defs/contents/get_commit.ts";
import { get_directory_tree } from "./tool_defs/contents/get_directory_tree.ts";
import { get_file_content } from "./tool_defs/contents/get_file_content.ts";
import { list_commits } from "./tool_defs/contents/list_commits.ts";
import { create_deployment } from "./tool_defs/deployments/create_deployment.ts";
import { create_deployment_status } from "./tool_defs/deployments/create_deployment_status.ts";
import { get_pages_info } from "./tool_defs/deployments/get_pages_info.ts";
import { list_deployments } from "./tool_defs/deployments/list_deployments.ts";
import { list_pages_builds } from "./tool_defs/deployments/list_pages_builds.ts";
import { trigger_pages_build } from "./tool_defs/deployments/trigger_pages_build.ts";
import { create_or_update_environment } from "./tool_defs/environments/create_or_update_environment.ts";
import { delete_environment } from "./tool_defs/environments/delete_environment.ts";
import { get_environment } from "./tool_defs/environments/get_environment.ts";
import { list_environments } from "./tool_defs/environments/list_environments.ts";
import { add_assignees } from "./tool_defs/issues/add_assignees.ts";
import { create_issue } from "./tool_defs/issues/create_issue.ts";
import { create_issue_comment } from "./tool_defs/issues/create_issue_comment.ts";
import { delete_issue_comment } from "./tool_defs/issues/delete_issue_comment.ts";
import { list_issue_comments } from "./tool_defs/issues/list_issue_comments.ts";
import { lock_issue } from "./tool_defs/issues/lock_issue.ts";
import { manage_labels } from "./tool_defs/issues/manage_labels.ts";
import { manage_milestones } from "./tool_defs/issues/manage_milestones.ts";
import { remove_assignees } from "./tool_defs/issues/remove_assignees.ts";
import { unlock_issue } from "./tool_defs/issues/unlock_issue.ts";
import { update_issue } from "./tool_defs/issues/update_issue.ts";
import { update_issue_comment } from "./tool_defs/issues/update_issue_comment.ts";
import { add_member_to_platform } from "./tool_defs/membership/add_member_to_platform.ts";
import { remove_member_from_platform } from "./tool_defs/membership/remove_member_from_platform.ts";
import { add_team_member } from "./tool_defs/organization/add_team_member.ts";
import { create_webhook } from "./tool_defs/organization/create_webhook.ts";
import { delete_webhook } from "./tool_defs/organization/delete_webhook.ts";
import { get_org_member } from "./tool_defs/organization/get_org_member.ts";
import { get_team } from "./tool_defs/organization/get_team.ts";
import { invite_org_member } from "./tool_defs/organization/invite_org_member.ts";
import { list_org_members } from "./tool_defs/organization/list_org_members.ts";
import { list_org_webhooks } from "./tool_defs/organization/list_org_webhooks.ts";
import { list_repo_webhooks } from "./tool_defs/organization/list_repo_webhooks.ts";
import { list_team_members } from "./tool_defs/organization/list_team_members.ts";
import { list_teams } from "./tool_defs/organization/list_teams.ts";
import { remove_org_member } from "./tool_defs/organization/remove_org_member.ts";
import { remove_team_member } from "./tool_defs/organization/remove_team_member.ts";
import { update_webhook } from "./tool_defs/organization/update_webhook.ts";
import { delete_package_version } from "./tool_defs/packages/delete_package_version.ts";
import { get_package } from "./tool_defs/packages/get_package.ts";
import { list_package_versions } from "./tool_defs/packages/list_package_versions.ts";
import { list_packages } from "./tool_defs/packages/list_packages.ts";
import { create_project_item } from "./tool_defs/projects/create_project_item.ts";
import { delete_project_item } from "./tool_defs/projects/delete_project_item.ts";
import { get_project } from "./tool_defs/projects/get_project.ts";
import { list_org_projects } from "./tool_defs/projects/list_org_projects.ts";
import { list_project_items } from "./tool_defs/projects/list_project_items.ts";
import { update_project_item } from "./tool_defs/projects/update_project_item.ts";
import { close_pull_request } from "./tool_defs/pull-requests/close_pull_request.ts";
import { create_pr_review } from "./tool_defs/pull-requests/create_pr_review.ts";
import { create_pull_request } from "./tool_defs/pull-requests/create_pull_request.ts";
import { list_pr_comments } from "./tool_defs/pull-requests/list_pr_comments.ts";
import { list_pr_files } from "./tool_defs/pull-requests/list_pr_files.ts";
import { list_pr_reviews } from "./tool_defs/pull-requests/list_pr_reviews.ts";
import { merge_pull_request } from "./tool_defs/pull-requests/merge_pull_request.ts";
import { remove_requested_reviewers } from "./tool_defs/pull-requests/remove_requested_reviewers.ts";
import { request_reviewers } from "./tool_defs/pull-requests/request_reviewers.ts";
import { update_pull_request } from "./tool_defs/pull-requests/update_pull_request.ts";
import { add_comment_reaction } from "./tool_defs/reactions/add_comment_reaction.ts";
import { add_issue_reaction } from "./tool_defs/reactions/add_issue_reaction.ts";
import { remove_comment_reaction } from "./tool_defs/reactions/remove_comment_reaction.ts";
import { remove_issue_reaction } from "./tool_defs/reactions/remove_issue_reaction.ts";
import { create_release } from "./tool_defs/releases/create_release.ts";
import { delete_release } from "./tool_defs/releases/delete_release.ts";
import { get_release } from "./tool_defs/releases/get_release.ts";
import { list_release_assets } from "./tool_defs/releases/list_release_assets.ts";
import { list_releases } from "./tool_defs/releases/list_releases.ts";
import { update_release } from "./tool_defs/releases/update_release.ts";
import { archive_repository } from "./tool_defs/repositories/archive_repository.ts";
import { create_repository } from "./tool_defs/repositories/create_repository.ts";
import { delete_branch_protection } from "./tool_defs/repositories/delete_branch_protection.ts";
import { delete_repository } from "./tool_defs/repositories/delete_repository.ts";
import { get_branch_protection } from "./tool_defs/repositories/get_branch_protection.ts";
import { list_branches } from "./tool_defs/repositories/list_branches.ts";
import { set_branch_protection } from "./tool_defs/repositories/set_branch_protection.ts";
import { transfer_repository } from "./tool_defs/repositories/transfer_repository.ts";
import { update_repository } from "./tool_defs/repositories/update_repository.ts";
import { create_or_update_org_secret } from "./tool_defs/secrets-and-variables/create_or_update_org_secret.ts";
import { create_or_update_org_variable } from "./tool_defs/secrets-and-variables/create_or_update_org_variable.ts";
import { create_or_update_repo_secret } from "./tool_defs/secrets-and-variables/create_or_update_repo_secret.ts";
import { create_or_update_repo_variable } from "./tool_defs/secrets-and-variables/create_or_update_repo_variable.ts";
import { delete_org_secret } from "./tool_defs/secrets-and-variables/delete_org_secret.ts";
import { delete_org_variable } from "./tool_defs/secrets-and-variables/delete_org_variable.ts";
import { delete_repo_secret } from "./tool_defs/secrets-and-variables/delete_repo_secret.ts";
import { delete_repo_variable } from "./tool_defs/secrets-and-variables/delete_repo_variable.ts";
import { list_org_secrets } from "./tool_defs/secrets-and-variables/list_org_secrets.ts";
import { list_org_variables } from "./tool_defs/secrets-and-variables/list_org_variables.ts";
import { list_repo_secrets } from "./tool_defs/secrets-and-variables/list_repo_secrets.ts";
import { list_repo_variables } from "./tool_defs/secrets-and-variables/list_repo_variables.ts";
import { create_ref } from "./tool_defs/tags-refs/create_ref.ts";
import { delete_ref } from "./tool_defs/tags-refs/delete_ref.ts";
import { get_ref } from "./tool_defs/tags-refs/get_ref.ts";
import { list_refs } from "./tool_defs/tags-refs/list_refs.ts";
import { list_tags } from "./tool_defs/tags-refs/list_tags.ts";
import { update_ref } from "./tool_defs/tags-refs/update_ref.ts";

export const GITHUB_TOOLS = {
  add_assignees,
  add_collaborator,
  add_comment_reaction,
  add_issue_reaction,
  add_member_to_platform,
  add_team_member,
  archive_repository,
  cancel_repo_invitation,
  cancel_workflow_run,
  close_pull_request,
  compare_commits,
  create_deployment,
  create_deployment_status,
  create_issue,
  create_issue_comment,
  create_or_update_environment,
  create_or_update_file,
  create_or_update_org_secret,
  create_or_update_org_variable,
  create_or_update_repo_secret,
  create_or_update_repo_variable,
  create_pr_review,
  create_project_item,
  create_pull_request,
  create_ref,
  create_release,
  create_repository,
  create_webhook,
  delete_branch_protection,
  delete_environment,
  delete_file,
  delete_issue_comment,
  delete_org_secret,
  delete_org_variable,
  delete_package_version,
  delete_project_item,
  delete_ref,
  delete_release,
  delete_repo_secret,
  delete_repo_variable,
  delete_repository,
  delete_webhook,
  download_artifact,
  get_branch_protection,
  get_commit,
  get_directory_tree,
  get_environment,
  get_file_content,
  get_org_member,
  get_package,
  get_pages_info,
  get_project,
  get_ref,
  get_release,
  get_repository,
  get_team,
  get_workflow_run,
  invite_org_member,
  list_branches,
  list_collaborators,
  list_commits,
  list_deployments,
  list_environments,
  list_issue_comments,
  list_org_members,
  list_org_projects,
  list_org_secrets,
  list_org_variables,
  list_org_webhooks,
  list_package_versions,
  list_packages,
  list_pages_builds,
  list_pr_comments,
  list_pr_files,
  list_pr_reviews,
  list_project_items,
  list_refs,
  list_release_assets,
  list_releases,
  list_repo_invitations,
  list_repo_secrets,
  list_repo_variables,
  list_repo_webhooks,
  list_repositories,
  list_tags,
  list_team_members,
  list_teams,
  list_workflow_jobs,
  list_workflow_runs,
  list_workflows,
  lock_issue,
  manage_labels,
  manage_milestones,
  merge_pull_request,
  remove_assignees,
  remove_collaborator,
  remove_comment_reaction,
  remove_issue_reaction,
  remove_member_from_platform,
  remove_org_member,
  remove_requested_reviewers,
  remove_team_member,
  request_reviewers,
  rerun_workflow,
  search_code,
  search_issues,
  set_branch_protection,
  transfer_repository,
  trigger_pages_build,
  trigger_workflow,
  unlock_issue,
  update_issue,
  update_issue_comment,
  update_project_item,
  update_pull_request,
  update_ref,
  update_release,
  update_repository,
  update_webhook,
} as const satisfies Record<string, DomainToolSpec>;

export type GithubToolName = keyof typeof GITHUB_TOOLS;

export const GITHUB_BASE_TOOL_NAMES = [
  "list_repositories",
  "get_repository",
  "search_code",
  "search_issues",
] as const;

export const GITHUB_SKILLS = [
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
