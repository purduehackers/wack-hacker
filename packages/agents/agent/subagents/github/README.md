# `github`

Everything Purdue Hackers keeps in the `purduehackers` GitHub organization:
repositories and their contents, refs and tags, issues and pull requests,
Actions, deployments and Pages, packages, Projects v2, and org membership.

The owner half of a repository is never an input. It comes from
`GITHUB_ORG`, so a tool only ever names the repo, and this subagent cannot
reach a repository outside the organization.

It does not write code. Editing files here is a commit against a branch —
`create_or_update_file` and `delete_file` take content and produce a commit,
with no build, no test run, and no way to see whether the result compiles.
Authoring changes belongs to the `code` subagent. It does not own hosting
either: `list_deployments` and `create_deployment` read and write GitHub's
own deployment records, which are annotations on a commit and not the thing
that put a site online. Vercel is the `vercel` subagent, runtime errors are
`sentry`, and product planning is `linear`.

`search_code` goes through grep.app rather than GitHub's code search, so it
returns snippets fast across the whole org but reflects grep.app's index
rather than the current default branch.

<!-- generated: do not edit below this line -->

## Surface

**119 tools** across **16 skills**, plus 4 always-available.

## Skills

| Skill                                                              | Role      | Tools | Description                                                                             |
| ------------------------------------------------------------------ | --------- | ----: | --------------------------------------------------------------------------------------- |
| [`actions`](lib/skill_defs/actions.md)                             | organizer |     8 | List and manage workflows, workflow runs, jobs, and artifacts.                          |
| [`collaborators`](lib/skill_defs/collaborators.md)                 | admin     |     5 | Manage direct repository collaborators and pending invitations (admin only for writes). |
| [`contents`](lib/skill_defs/contents.md)                           | organizer |     7 | Read and write file contents; browse directory trees; view commits and diffs.           |
| [`deployments`](lib/skill_defs/deployments.md)                     | organizer |     6 | Manage deployments, deployment statuses, and GitHub Pages.                              |
| [`environments`](lib/skill_defs/environments.md)                   | organizer |     4 | Manage deployment environments — protection rules, wait timers, required reviewers.     |
| [`issues`](lib/skill_defs/issues.md)                               | organizer |    12 | Create, update, and manage issues; manage labels and milestones.                        |
| [`membership`](lib/skill_defs/membership.md)                       | admin     |     2 | Invite or remove members from the purduehackers GitHub organization (admin only).       |
| [`organization`](lib/skill_defs/organization.md)                   | organizer |    14 | View organization members and teams; manage team membership and webhooks.               |
| [`packages`](lib/skill_defs/packages.md)                           | organizer |     4 | List, inspect, and manage organization packages.                                        |
| [`projects`](lib/skill_defs/projects.md)                           | organizer |     6 | Manage GitHub Projects v2 — list projects, view and manage items.                       |
| [`pull-requests`](lib/skill_defs/pull-requests.md)                 | organizer |    10 | Create, update, review, and merge pull requests.                                        |
| [`reactions`](lib/skill_defs/reactions.md)                         | organizer |     4 | Add or remove reaction emojis on issues and issue/PR comments.                          |
| [`releases`](lib/skill_defs/releases.md)                           | organizer |     6 | Manage GitHub releases — list, create, update, and delete releases and their assets.    |
| [`repositories`](lib/skill_defs/repositories.md)                   | organizer |     9 | Create, update, and delete repositories; manage branches and branch protection.         |
| [`secrets-and-variables`](lib/skill_defs/secrets-and-variables.md) | organizer |    12 | Manage repository and organization secrets and variables for GitHub Actions.            |
| [`tags-refs`](lib/skill_defs/tags-refs.md)                         | organizer |     6 | Manage git refs (branches and tags) — list, create, update, and delete.                 |

## Always available

Reachable without loading a skill.

| Tool                | Risk | Role   | What it does                                                                                                           |
| ------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get_repository`    | read | public | Get full details for a repository — description, branches, topics, visibility, license, issue/wiki/pages status, and … |
| `list_repositories` | read | public | List repositories in the purduehackers org.                                                                            |
| `search_code`       | read | public | Search code across purduehackers repositories using grep.app.                                                          |
| `search_issues`     | read | public | Search issues and pull requests across purduehackers repos.                                                            |

## `actions`

List and manage workflows, workflow runs, jobs, and artifacts.

| Tool                  | Risk        | Role      | What it does                                                                                                           |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cancel_workflow_run` | destructive | organizer | Cancel a workflow run that is currently in progress or queued.                                                         |
| `download_artifact`   | read        | public    | Get the download URL for a workflow artifact by its ID.                                                                |
| `get_workflow_run`    | read        | public    | Get detailed information about a specific workflow run, including its status, conclusion, triggering event, branch, c… |
| `list_workflow_jobs`  | read        | public    | List jobs for a workflow run.                                                                                          |
| `list_workflow_runs`  | read        | public    | List workflow runs for a repository.                                                                                   |
| `list_workflows`      | read        | public    | List CI/CD workflows defined in a repository's .github/workflows directory.                                            |
| `rerun_workflow`      | destructive | organizer | Re-run a completed workflow run.                                                                                       |
| `trigger_workflow`    | destructive | organizer | Trigger a workflow_dispatch event to manually run a workflow.                                                          |

## `collaborators`

Manage direct repository collaborators and pending invitations (admin only for writes).

| Tool                     | Risk        | Role   | What it does                                            |
| ------------------------ | ----------- | ------ | ------------------------------------------------------- |
| `add_collaborator`       | destructive | admin  | Add a user as a direct collaborator on a repository.    |
| `cancel_repo_invitation` | destructive | admin  | Revoke a pending collaborator invitation by ID.         |
| `list_collaborators`     | read        | public | List collaborators with direct access to a repository.  |
| `list_repo_invitations`  | read        | admin  | List pending collaborator invitations for a repository. |
| `remove_collaborator`    | destructive | admin  | Remove a collaborator from a repository.                |

## `contents`

Read and write file contents; browse directory trees; view commits and diffs.

| Tool                    | Risk        | Role      | What it does                                                                                                           |
| ----------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `compare_commits`       | read        | public    | Compare two commits, branches, or tags.                                                                                |
| `create_or_update_file` | write       | organizer | Create or update a file in a repository.                                                                               |
| `delete_file`           | destructive | organizer | Delete a file from a repository by creating a commit that removes it.                                                  |
| `get_commit`            | read        | public    | Get full details for a single commit, including message, author, date, stats (additions/deletions), and a list of cha… |
| `get_directory_tree`    | read        | public    | Get the full recursive directory tree of a repository.                                                                 |
| `get_file_content`      | read        | public    | Get the content of a file or list entries in a directory.                                                              |
| `list_commits`          | read        | public    | List commits for a repository, optionally filtered by branch, file path, or date range.                                |

## `deployments`

Manage deployments, deployment statuses, and GitHub Pages.

| Tool                       | Risk        | Role      | What it does                                                                                                           |
| -------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_deployment`        | destructive | organizer | Create a new deployment for a repository.                                                                              |
| `create_deployment_status` | write       | organizer | Create a status update for an existing deployment.                                                                     |
| `get_pages_info`           | read        | public    | Get the GitHub Pages configuration for a repository, including the published URL, status, source branch/path, and HTT… |
| `list_deployments`         | read        | public    | List deployments for a repository.                                                                                     |
| `list_pages_builds`        | read        | public    | List GitHub Pages builds for a repository.                                                                             |
| `trigger_pages_build`      | destructive | organizer | Manually trigger a GitHub Pages build for a repository.                                                                |

## `environments`

Manage deployment environments — protection rules, wait timers, required reviewers.

| Tool                           | Risk        | Role      | What it does                                                                 |
| ------------------------------ | ----------- | --------- | ---------------------------------------------------------------------------- |
| `create_or_update_environment` | destructive | organizer | Create or update a deployment environment.                                   |
| `delete_environment`           | destructive | organizer | Delete a deployment environment.                                             |
| `get_environment`              | read        | public    | Get details for a single deployment environment, including protection rules. |
| `list_environments`            | read        | public    | List deployment environments for a repository.                               |

## `issues`

Create, update, and manage issues; manage labels and milestones.

| Tool                   | Risk        | Role      | What it does                                                               |
| ---------------------- | ----------- | --------- | -------------------------------------------------------------------------- |
| `add_assignees`        | write       | organizer | Add assignees to an issue or PR.                                           |
| `create_issue`         | write       | organizer | Create a new issue in a repository.                                        |
| `create_issue_comment` | write       | organizer | Add a new comment to an issue.                                             |
| `delete_issue_comment` | destructive | organizer | Permanently delete an issue comment by its ID.                             |
| `list_issue_comments`  | read        | public    | List comments on an issue.                                                 |
| `lock_issue`           | write       | organizer | Lock the conversation on an issue or PR so only collaborators can comment. |
| `manage_labels`        | destructive | organizer | Create, update, or delete a label in a repository.                         |
| `manage_milestones`    | destructive | organizer | Create, update, or delete a milestone in a repository.                     |
| `remove_assignees`     | write       | organizer | Remove assignees from an issue or PR.                                      |
| `unlock_issue`         | write       | organizer | Unlock a previously locked issue or PR conversation.                       |
| `update_issue`         | write       | organizer | Update an existing issue.                                                  |
| `update_issue_comment` | write       | organizer | Edit an existing issue comment by its ID.                                  |

## `membership`

Invite or remove members from the purduehackers GitHub organization (admin only).

| Tool                          | Risk        | Role  | What it does                                            |
| ----------------------------- | ----------- | ----- | ------------------------------------------------------- |
| `add_member_to_platform`      | destructive | admin | Invite a GitHub user to the purduehackers organization. |
| `remove_member_from_platform` | destructive | admin | Remove a user from the purduehackers organization.      |

## `organization`

View organization members and teams; manage team membership and webhooks.

| Tool                 | Risk        | Role      | What it does                                                                 |
| -------------------- | ----------- | --------- | ---------------------------------------------------------------------------- |
| `add_team_member`    | destructive | admin     | Add a user to a team or update their team role.                              |
| `create_webhook`     | destructive | organizer | Create a webhook for a repository.                                           |
| `delete_webhook`     | destructive | organizer | Delete a repository webhook.                                                 |
| `get_org_member`     | read        | public    | Get organization membership details for a GitHub user.                       |
| `get_team`           | read        | public    | Get details for a team by slug.                                              |
| `invite_org_member`  | destructive | admin     | Invite a GitHub user to the purduehackers organization or update their role. |
| `list_org_members`   | read        | public    | List members of the purduehackers organization.                              |
| `list_org_webhooks`  | read        | public    | List webhooks configured for the purduehackers organization.                 |
| `list_repo_webhooks` | read        | public    | List webhooks configured for a repository.                                   |
| `list_team_members`  | read        | public    | List members of a team.                                                      |
| `list_teams`         | read        | public    | List teams in the purduehackers organization.                                |
| `remove_org_member`  | destructive | admin     | Remove a user from the purduehackers organization.                           |
| `remove_team_member` | destructive | admin     | Remove a user from a team.                                                   |
| `update_webhook`     | destructive | organizer | Update a repository webhook's URL, events, secret, or active status.         |

## `packages`

List, inspect, and manage organization packages.

| Tool                     | Risk        | Role      | What it does                                                                                                           |
| ------------------------ | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `delete_package_version` | destructive | organizer | Delete a specific version of a package from the purduehackers organization.                                            |
| `get_package`            | read        | public    | Get detailed information about a specific package in the purduehackers organization, including its ID, name, type, vi… |
| `list_package_versions`  | read        | public    | List all versions of a package in the purduehackers organization.                                                      |
| `list_packages`          | read        | public    | List packages in the purduehackers organization filtered by package type (npm, docker, container, etc.).               |

## `projects`

Manage GitHub Projects v2 — list projects, view and manage items.

| Tool                  | Risk        | Role      | What it does                                                      |
| --------------------- | ----------- | --------- | ----------------------------------------------------------------- |
| `create_project_item` | write       | organizer | Add an existing issue or pull request to a GitHub Project v2.     |
| `delete_project_item` | destructive | organizer | Remove an item from a GitHub Project v2.                          |
| `get_project`         | read        | public    | Get detailed information about a GitHub Project v2 by its number. |
| `list_org_projects`   | read        | public    | List GitHub Projects v2 in the purduehackers organization.        |
| `list_project_items`  | read        | public    | List items in a GitHub Project v2.                                |
| `update_project_item` | write       | organizer | Update a field value on a project item in a GitHub Project v2.    |

## `pull-requests`

Create, update, review, and merge pull requests.

| Tool                         | Risk        | Role      | What it does                                                   |
| ---------------------------- | ----------- | --------- | -------------------------------------------------------------- |
| `close_pull_request`         | write       | organizer | Close a pull request without merging.                          |
| `create_pr_review`           | write       | organizer | Submit a review on a pull request.                             |
| `create_pull_request`        | write       | organizer | Create a new pull request in a repository.                     |
| `list_pr_comments`           | read        | public    | List review comments (inline code comments) on a pull request. |
| `list_pr_files`              | read        | public    | List files changed in a pull request.                          |
| `list_pr_reviews`            | read        | public    | List reviews on a pull request.                                |
| `merge_pull_request`         | destructive | organizer | Merge a pull request.                                          |
| `remove_requested_reviewers` | destructive | organizer | Remove previously-requested reviewers from a pull request.     |
| `request_reviewers`          | write       | organizer | Request reviewers on a pull request.                           |
| `update_pull_request`        | write       | organizer | Update an existing pull request.                               |

## `reactions`

Add or remove reaction emojis on issues and issue/PR comments.

| Tool                      | Risk        | Role      | What it does                                                  |
| ------------------------- | ----------- | --------- | ------------------------------------------------------------- |
| `add_comment_reaction`    | write       | organizer | Add a reaction to an issue or PR comment.                     |
| `add_issue_reaction`      | write       | organizer | Add a reaction emoji to an issue.                             |
| `remove_comment_reaction` | destructive | organizer | Remove a reaction from an issue or PR comment by reaction ID. |
| `remove_issue_reaction`   | destructive | organizer | Remove a reaction from an issue by reaction ID.               |

## `releases`

Manage GitHub releases — list, create, update, and delete releases and their assets.

| Tool                  | Risk        | Role      | What it does                                                                                   |
| --------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------- |
| `create_release`      | write       | organizer | Create a new release for a repository.                                                         |
| `delete_release`      | destructive | organizer | Delete a release by ID.                                                                        |
| `get_release`         | read        | public    | Get full details for a release including its body, assets, author, and timestamps.             |
| `list_release_assets` | read        | public    | List assets (attached files) on a release.                                                     |
| `list_releases`       | read        | public    | List releases for a repository, newest first.                                                  |
| `update_release`      | write       | organizer | Update an existing release's tag name, title, body, draft/prerelease status, or target branch. |

## `repositories`

Create, update, and delete repositories; manage branches and branch protection.

| Tool                       | Risk        | Role      | What it does                                                                                                          |
| -------------------------- | ----------- | --------- | --------------------------------------------------------------------------------------------------------------------- |
| `archive_repository`       | destructive | organizer | Archive a repository — makes it read-only.                                                                            |
| `create_repository`        | write       | organizer | Create a new repository in the purduehackers organization.                                                            |
| `delete_branch_protection` | destructive | organizer | Remove all branch protection rules from a branch, making it unprotected.                                              |
| `delete_repository`        | destructive | organizer | Permanently delete a repository.                                                                                      |
| `get_branch_protection`    | read        | public    | Get branch protection rules — required status checks, review requirements, admin enforcement, and push restrictions.  |
| `list_branches`            | read        | public    | List branches for a repository.                                                                                       |
| `set_branch_protection`    | destructive | organizer | Set or update branch protection rules — status checks, admin enforcement, review requirements, and push restrictions. |
| `transfer_repository`      | destructive | organizer | Transfer a repository to a different owner (user or org).                                                             |
| `update_repository`        | destructive | organizer | Update repository settings — description, visibility, archive status, default branch, and merge strategies.           |

## `secrets-and-variables`

Manage repository and organization secrets and variables for GitHub Actions.

| Tool                             | Risk        | Role      | What it does                                               |
| -------------------------------- | ----------- | --------- | ---------------------------------------------------------- |
| `create_or_update_org_secret`    | destructive | organizer | Create or update an Actions secret for the organization.   |
| `create_or_update_org_variable`  | destructive | organizer | Create or update an Actions variable for the organization. |
| `create_or_update_repo_secret`   | destructive | organizer | Create or update an Actions secret for a repository.       |
| `create_or_update_repo_variable` | destructive | organizer | Create or update an Actions variable for a repository.     |
| `delete_org_secret`              | destructive | organizer | Delete an Actions secret from the organization.            |
| `delete_org_variable`            | destructive | organizer | Delete an Actions variable from the organization.          |
| `delete_repo_secret`             | destructive | organizer | Delete an Actions secret from a repository.                |
| `delete_repo_variable`           | destructive | organizer | Delete an Actions variable from a repository.              |
| `list_org_secrets`               | read        | public    | List Actions secrets for the purduehackers organization.   |
| `list_org_variables`             | read        | public    | List Actions variables for the purduehackers organization. |
| `list_repo_secrets`              | read        | public    | List Actions secrets for a repository.                     |
| `list_repo_variables`            | read        | public    | List Actions variables for a repository.                   |

## `tags-refs`

Manage git refs (branches and tags) — list, create, update, and delete.

| Tool         | Risk        | Role      | What it does                                                |
| ------------ | ----------- | --------- | ----------------------------------------------------------- |
| `create_ref` | write       | organizer | Create a new branch or tag.                                 |
| `delete_ref` | destructive | organizer | Delete a git ref (branch or tag).                           |
| `get_ref`    | read        | public    | Get a single git ref (branch or tag) by its full name (e.g. |
| `list_refs`  | read        | public    | List git refs (branches or tags) matching a prefix.         |
| `list_tags`  | read        | public    | List tags for a repository.                                 |
| `update_ref` | destructive | organizer | Update a ref to point to a different commit SHA.            |
