# `linear`

Purdue Hackers' project management: the issues, projects, initiatives, cycles,
documents, labels, teams and workspace members that live in the Linear
workspace.

The workspace is a hierarchy, and the tools read as one. An **initiative** is a
strategic goal spanning projects; a **project** groups issues toward a
deliverable and carries milestones; a **cycle** is a time box a team's issues
are pulled into; an **issue** is the unit of work. Status updates hang off
projects and initiatives, documents hang off any of them, and customer requests
attach outside feedback to an issue or project.

Everything Linear accepts is a UUID and everything a person says is a name, so
`suggest_property_values` and `search_entities` come first — always. Guessing an
assignee, team, workflow state or milestone id produces a rejected mutation at
best and the wrong person's issue at worst.

It does not own Purdue Hackers' engineering artifacts. Code, pull requests and
CI belong to the `github` subagent, deploys to `vercel`, and errors to
`sentry` — an issue that references any of them is still just an issue here.
Nor does it own workspace administration beyond membership: billing, SSO and
workspace settings are not reachable from a chat message.

<!-- generated: do not edit below this line -->

## Surface

**64 tools** across **16 skills**, plus 4 always-available.

## Skills

| Skill                                                        | Role      | Tools | Description                                                                        |
| ------------------------------------------------------------ | --------- | ----: | ---------------------------------------------------------------------------------- |
| [`comments`](lib/skill_defs/comments.md)                     | organizer |     3 | Post, edit, and delete comments on issues.                                         |
| [`customer-requests`](lib/skill_defs/customer-requests.md)   | organizer |     3 | Create, update, list, and analyze customer requests.                               |
| [`cycles`](lib/skill_defs/cycles.md)                         | organizer |     5 | List, create, update, and archive Linear cycles (sprints).                         |
| [`documents`](lib/skill_defs/documents.md)                   | organizer |     2 | Create and update documents attached to a project, initiative, issue, or cycle.    |
| [`initiative-updates`](lib/skill_defs/initiative-updates.md) | organizer |     3 | Query, create, and update initiative status updates.                               |
| [`initiatives`](lib/skill_defs/initiatives.md)               | organizer |     4 | Create/update initiatives; query initiative activity and history.                  |
| [`issue-views`](lib/skill_defs/issue-views.md)               | organizer |     1 | Query and analyze issue views in list or insight mode, with filters.               |
| [`issues`](lib/skill_defs/issues.md)                         | organizer |     6 | Create, update, delete issues; query issue activity and history.                   |
| [`labels`](lib/skill_defs/labels.md)                         | organizer |     5 | List, create, update, and delete Linear issue labels.                              |
| [`membership`](lib/skill_defs/membership.md)                 | admin     |     2 | Invite new members to the Linear workspace or remove existing ones (admin only).   |
| [`project-updates`](lib/skill_defs/project-updates.md)       | organizer |     3 | Query, create, and update project status updates.                                  |
| [`project-views`](lib/skill_defs/project-views.md)           | organizer |     1 | Query and analyze project views in list or count mode, with filters.               |
| [`projects`](lib/skill_defs/projects.md)                     | organizer |    10 | Create/update projects and milestones; query project activity.                     |
| [`reminders`](lib/skill_defs/reminders.md)                   | organizer |     1 | Set a reminder for the current user on an issue, document, project, or initiative. |
| [`teams`](lib/skill_defs/teams.md)                           | organizer |     3 | List team members and manage team membership.                                      |
| [`users`](lib/skill_defs/users.md)                           | organizer |     9 | List, inspect, and manage workspace users — profiles, teams, workload, invites.    |

## Always available

Reachable without loading a skill.

| Tool                      | Risk | Role   | What it does                                                                                |
| ------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------- |
| `aggregate_issues`        | read | public | Get aggregated issue counts grouped by status, assignee, label, priority, project, or team. |
| `retrieve_entities`       | read | public | Fetch full details for one or more entities by ID, identifier (e.g.                         |
| `search_entities`         | read | public | Search Linear entities by keyword.                                                          |
| `suggest_property_values` | read | public | Resolve human-readable names to Linear UUIDs for entity fields.                             |

## `comments`

Post, edit, and delete comments on issues.

| Tool             | Risk        | Role      | What it does                                   |
| ---------------- | ----------- | --------- | ---------------------------------------------- |
| `create_comment` | write       | organizer | Post a Markdown comment on an issue.           |
| `delete_comment` | destructive | organizer | Delete a comment by ID.                        |
| `edit_comment`   | write       | organizer | Edit an existing comment's body by comment ID. |

## `customer-requests`

Create, update, list, and analyze customer requests.

| Tool                   | Risk  | Role      | What it does                                                               |
| ---------------------- | ----- | --------- | -------------------------------------------------------------------------- |
| `create_customer_need` | write | organizer | Create a customer request (feedback/need) attached to an issue or project. |
| `list_customer_needs`  | read  | public    | List all customer requests with priority and creation date.                |
| `update_customer_need` | write | organizer | Update a customer request.                                                 |

## `cycles`

List, create, update, and archive Linear cycles (sprints).

| Tool            | Risk        | Role      | What it does                                              |
| --------------- | ----------- | --------- | --------------------------------------------------------- |
| `archive_cycle` | destructive | organizer | Archive a cycle.                                          |
| `create_cycle`  | write       | organizer | Create a new cycle for a team.                            |
| `get_cycle`     | read        | public    | Get a single cycle's full details by ID.                  |
| `list_cycles`   | read        | public    | List cycles (sprints) for a team or across the workspace. |
| `update_cycle`  | write       | organizer | Update a cycle's name, description, or dates.             |

## `documents`

Create and update documents attached to a project, initiative, issue, or cycle.

| Tool              | Risk  | Role      | What it does                                                                                       |
| ----------------- | ----- | --------- | -------------------------------------------------------------------------------------------------- |
| `create_document` | write | organizer | Create a Markdown document attached to exactly one parent: a project, initiative, issue, or cycle. |
| `update_document` | write | organizer | Update a document's Markdown content or move it to a different parent entity.                      |

## `initiative-updates`

Query, create, and update initiative status updates.

| Tool                       | Risk  | Role      | What it does                                                                                |
| -------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------- |
| `create_initiative_update` | write | organizer | Create an initiative status update with Markdown body and health (onTrack/atRisk/offTrack). |
| `query_initiative_updates` | read  | public    | List recent initiative status updates with body, health, date, and URL.                     |
| `update_initiative_update` | write | organizer | Edit an existing initiative update's body or health status.                                 |

## `initiatives`

Create/update initiatives; query initiative activity and history.

| Tool                        | Risk  | Role      | What it does                                                                |
| --------------------------- | ----- | --------- | --------------------------------------------------------------------------- |
| `create_initiative`         | write | organizer | Create an initiative (strategic goal grouping multiple projects).           |
| `list_initiatives`          | read  | public    | List all initiatives with name, status, target date, and URL.               |
| `query_initiative_activity` | read  | public    | Fetch an initiative's change history (status changes, owner changes, etc.). |
| `update_initiative`         | write | organizer | Update an initiative by ID.                                                 |

## `issue-views`

Query and analyze issue views in list or insight mode, with filters.

| Tool               | Risk | Role   | What it does               |
| ------------------ | ---- | ------ | -------------------------- |
| `query_issue_view` | read | public | Query issues with filters. |

## `issues`

Create, update, delete issues; query issue activity and history.

| Tool                   | Risk        | Role      | What it does                                              |
| ---------------------- | ----------- | --------- | --------------------------------------------------------- |
| `archive_issue`        | destructive | organizer | Archive an issue.                                         |
| `create_issue`         | write       | organizer | Create a new issue.                                       |
| `delete_issue`         | destructive | organizer | Permanently delete an issue by ID.                        |
| `query_issue_activity` | read        | public    | Fetch an issue's field change history and comment thread. |
| `unarchive_issue`      | write       | organizer | Restore an archived issue back to its previous state.     |
| `update_issue`         | write       | organizer | Update an existing issue by ID.                           |

## `labels`

List, create, update, and delete Linear issue labels.

| Tool           | Risk        | Role      | What it does                                   |
| -------------- | ----------- | --------- | ---------------------------------------------- |
| `create_label` | write       | organizer | Create a new issue label.                      |
| `delete_label` | destructive | organizer | Delete a label.                                |
| `get_label`    | read        | public    | Get details for a single label by ID.          |
| `list_labels`  | read        | public    | List issue labels across the Linear workspace. |
| `update_label` | write       | organizer | Update a label's name, color, or description.  |

## `membership`

Invite new members to the Linear workspace or remove existing ones (admin only).

| Tool                          | Risk        | Role  | What it does                               |
| ----------------------------- | ----------- | ----- | ------------------------------------------ |
| `add_member_to_platform`      | destructive | admin | Send a Linear workspace invite by email.   |
| `remove_member_from_platform` | destructive | admin | Remove a member from the Linear workspace. |

## `project-updates`

Query, create, and update project status updates.

| Tool                    | Risk  | Role      | What it does                                                                            |
| ----------------------- | ----- | --------- | --------------------------------------------------------------------------------------- |
| `create_project_update` | write | organizer | Create a project status update with Markdown body and health (onTrack/atRisk/offTrack). |
| `query_project_updates` | read  | public    | List recent project status updates with body, health, date, and URL.                    |
| `update_project_update` | write | organizer | Edit an existing project update's body or health status.                                |

## `project-views`

Query and analyze project views in list or count mode, with filters.

| Tool                 | Risk | Role   | What it does                                              |
| -------------------- | ---- | ------ | --------------------------------------------------------- |
| `query_project_view` | read | public | List projects with lead/status/URL, or get a total count. |

## `projects`

Create/update projects and milestones; query project activity.

| Tool                       | Risk        | Role      | What it does                                                                                                   |
| -------------------------- | ----------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `archive_project`          | destructive | organizer | Archive a project.                                                                                             |
| `create_project`           | write       | organizer | Create a project.                                                                                              |
| `create_project_milestone` | write       | organizer | Create a milestone inside a project.                                                                           |
| `delete_project`           | destructive | organizer | Permanently delete a project.                                                                                  |
| `get_project`              | read        | public    | Get a single project's details by ID — name, status, description, progress, lead, target/start dates, and URL. |
| `query_project_activity`   | read        | public    | Fetch a project's change history, status updates, and comments.                                                |
| `query_project_view`       | read        | public    | List projects with lead/status/URL, or get a total count.                                                      |
| `unarchive_project`        | write       | organizer | Restore an archived project.                                                                                   |
| `update_project`           | write       | organizer | Update a project by ID.                                                                                        |
| `update_project_milestone` | write       | organizer | Update a project milestone.                                                                                    |

## `reminders`

Set a reminder for the current user on an issue, document, project, or initiative.

| Tool           | Risk  | Role      | What it does                |
| -------------- | ----- | --------- | --------------------------- |
| `set_reminder` | write | organizer | Set a reminder on an issue. |

## `teams`

List team members and manage team membership.

| Tool                    | Risk        | Role   | What it does                       |
| ----------------------- | ----------- | ------ | ---------------------------------- |
| `add_user_to_team`      | destructive | admin  | Add a user to a Linear team.       |
| `list_team_members`     | read        | public | List all members of a Linear team. |
| `remove_user_from_team` | destructive | admin  | Remove a user from a Linear team.  |

## `users`

List, inspect, and manage workspace users — profiles, teams, workload, invites.

| Tool                       | Risk        | Role   | What it does                                                                                                           |
| -------------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `delete_invite`            | destructive | admin  | Revoke a pending invite by ID.                                                                                         |
| `get_user`                 | read        | public | Get a user's full profile by ID — name, email, display name, roles, timezone, current status, issue count, and profil… |
| `get_user_assigned_issues` | read        | public | List open issues assigned to a user.                                                                                   |
| `get_user_teams`           | read        | public | List the teams a user belongs to.                                                                                      |
| `invite_user`              | destructive | admin  | Send a workspace invite by email.                                                                                      |
| `list_invites`             | read        | admin  | List all pending workspace invites with email, role, who sent it, and expiry date.                                     |
| `list_users`               | read        | public | List all workspace members.                                                                                            |
| `suspend_user`             | destructive | admin  | Suspend a user, disabling their access.                                                                                |
| `unsuspend_user`           | destructive | admin  | Restore a suspended user's access.                                                                                     |
