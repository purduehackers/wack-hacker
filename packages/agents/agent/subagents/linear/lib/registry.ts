/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there. The two
 * are the same fact seen twice. A Linear workspace is wide enough that the
 * drift shows up as a tool no skill teaches. `tool_defs/` mirrors the skill
 * list, so a new bundle is a directory and a list entry, never a third place.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md`, and this module imports it
 * as text. The markdown thus stays a real document while policy sits here
 * next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import commentsDoc from "./skill_defs/comments.md" with { type: "text" };
import customerRequestsDoc from "./skill_defs/customer-requests.md" with { type: "text" };
import cyclesDoc from "./skill_defs/cycles.md" with { type: "text" };
import documentsDoc from "./skill_defs/documents.md" with { type: "text" };
import initiativeUpdatesDoc from "./skill_defs/initiative-updates.md" with { type: "text" };
import initiativesDoc from "./skill_defs/initiatives.md" with { type: "text" };
import issueViewsDoc from "./skill_defs/issue-views.md" with { type: "text" };
import issuesDoc from "./skill_defs/issues.md" with { type: "text" };
import labelsDoc from "./skill_defs/labels.md" with { type: "text" };
import membershipDoc from "./skill_defs/membership.md" with { type: "text" };
import projectUpdatesDoc from "./skill_defs/project-updates.md" with { type: "text" };
import projectViewsDoc from "./skill_defs/project-views.md" with { type: "text" };
import projectsDoc from "./skill_defs/projects.md" with { type: "text" };
import remindersDoc from "./skill_defs/reminders.md" with { type: "text" };
import teamsDoc from "./skill_defs/teams.md" with { type: "text" };
import usersDoc from "./skill_defs/users.md" with { type: "text" };
import { aggregate_issues } from "./tool_defs/base/aggregate_issues.ts";
import { retrieve_entities } from "./tool_defs/base/retrieve_entities.ts";
import { search_entities } from "./tool_defs/base/search_entities.ts";
import { suggest_property_values } from "./tool_defs/base/suggest_property_values.ts";
import { create_comment } from "./tool_defs/comments/create_comment.ts";
import { delete_comment } from "./tool_defs/comments/delete_comment.ts";
import { edit_comment } from "./tool_defs/comments/edit_comment.ts";
import { create_customer_need } from "./tool_defs/customer-requests/create_customer_need.ts";
import { list_customer_needs } from "./tool_defs/customer-requests/list_customer_needs.ts";
import { update_customer_need } from "./tool_defs/customer-requests/update_customer_need.ts";
import { archive_cycle } from "./tool_defs/cycles/archive_cycle.ts";
import { create_cycle } from "./tool_defs/cycles/create_cycle.ts";
import { get_cycle } from "./tool_defs/cycles/get_cycle.ts";
import { list_cycles } from "./tool_defs/cycles/list_cycles.ts";
import { update_cycle } from "./tool_defs/cycles/update_cycle.ts";
import { create_document } from "./tool_defs/documents/create_document.ts";
import { update_document } from "./tool_defs/documents/update_document.ts";
import { create_initiative_update } from "./tool_defs/initiative-updates/create_initiative_update.ts";
import { query_initiative_updates } from "./tool_defs/initiative-updates/query_initiative_updates.ts";
import { update_initiative_update } from "./tool_defs/initiative-updates/update_initiative_update.ts";
import { create_initiative } from "./tool_defs/initiatives/create_initiative.ts";
import { list_initiatives } from "./tool_defs/initiatives/list_initiatives.ts";
import { query_initiative_activity } from "./tool_defs/initiatives/query_initiative_activity.ts";
import { update_initiative } from "./tool_defs/initiatives/update_initiative.ts";
import { query_issue_view } from "./tool_defs/issue-views/query_issue_view.ts";
import { archive_issue } from "./tool_defs/issues/archive_issue.ts";
import { create_issue } from "./tool_defs/issues/create_issue.ts";
import { delete_issue } from "./tool_defs/issues/delete_issue.ts";
import { query_issue_activity } from "./tool_defs/issues/query_issue_activity.ts";
import { unarchive_issue } from "./tool_defs/issues/unarchive_issue.ts";
import { update_issue } from "./tool_defs/issues/update_issue.ts";
import { create_label } from "./tool_defs/labels/create_label.ts";
import { delete_label } from "./tool_defs/labels/delete_label.ts";
import { get_label } from "./tool_defs/labels/get_label.ts";
import { list_labels } from "./tool_defs/labels/list_labels.ts";
import { update_label } from "./tool_defs/labels/update_label.ts";
import { add_member_to_platform } from "./tool_defs/membership/add_member_to_platform.ts";
import { remove_member_from_platform } from "./tool_defs/membership/remove_member_from_platform.ts";
import { create_project_update } from "./tool_defs/project-updates/create_project_update.ts";
import { query_project_updates } from "./tool_defs/project-updates/query_project_updates.ts";
import { update_project_update } from "./tool_defs/project-updates/update_project_update.ts";
import { query_project_view } from "./tool_defs/project-views/query_project_view.ts";
import { archive_project } from "./tool_defs/projects/archive_project.ts";
import { create_project } from "./tool_defs/projects/create_project.ts";
import { create_project_milestone } from "./tool_defs/projects/create_project_milestone.ts";
import { delete_project } from "./tool_defs/projects/delete_project.ts";
import { get_project } from "./tool_defs/projects/get_project.ts";
import { query_project_activity } from "./tool_defs/projects/query_project_activity.ts";
import { unarchive_project } from "./tool_defs/projects/unarchive_project.ts";
import { update_project } from "./tool_defs/projects/update_project.ts";
import { update_project_milestone } from "./tool_defs/projects/update_project_milestone.ts";
import { set_reminder } from "./tool_defs/reminders/set_reminder.ts";
import { add_user_to_team } from "./tool_defs/teams/add_user_to_team.ts";
import { list_team_members } from "./tool_defs/teams/list_team_members.ts";
import { remove_user_from_team } from "./tool_defs/teams/remove_user_from_team.ts";
import { delete_invite } from "./tool_defs/users/delete_invite.ts";
import { get_user } from "./tool_defs/users/get_user.ts";
import { get_user_assigned_issues } from "./tool_defs/users/get_user_assigned_issues.ts";
import { get_user_teams } from "./tool_defs/users/get_user_teams.ts";
import { invite_user } from "./tool_defs/users/invite_user.ts";
import { list_invites } from "./tool_defs/users/list_invites.ts";
import { list_users } from "./tool_defs/users/list_users.ts";
import { suspend_user } from "./tool_defs/users/suspend_user.ts";
import { unsuspend_user } from "./tool_defs/users/unsuspend_user.ts";

export const LINEAR_TOOLS = {
  add_member_to_platform,
  add_user_to_team,
  aggregate_issues,
  archive_cycle,
  archive_issue,
  archive_project,
  create_comment,
  create_customer_need,
  create_cycle,
  create_document,
  create_initiative,
  create_initiative_update,
  create_issue,
  create_label,
  create_project,
  create_project_milestone,
  create_project_update,
  delete_comment,
  delete_invite,
  delete_issue,
  delete_label,
  delete_project,
  edit_comment,
  get_cycle,
  get_label,
  get_project,
  get_user,
  get_user_assigned_issues,
  get_user_teams,
  invite_user,
  list_customer_needs,
  list_cycles,
  list_initiatives,
  list_invites,
  list_labels,
  list_team_members,
  list_users,
  query_initiative_activity,
  query_initiative_updates,
  query_issue_activity,
  query_issue_view,
  query_project_activity,
  query_project_updates,
  query_project_view,
  remove_member_from_platform,
  remove_user_from_team,
  retrieve_entities,
  search_entities,
  set_reminder,
  suggest_property_values,
  suspend_user,
  unarchive_issue,
  unarchive_project,
  unsuspend_user,
  update_customer_need,
  update_cycle,
  update_document,
  update_initiative,
  update_initiative_update,
  update_issue,
  update_label,
  update_project,
  update_project_milestone,
  update_project_update,
} as const satisfies Record<string, DomainToolSpec>;

export type LinearToolName = keyof typeof LINEAR_TOOLS;

export const LINEAR_BASE_TOOL_NAMES = [
  "search_entities",
  "retrieve_entities",
  "suggest_property_values",
  "aggregate_issues",
] as const;

export const LINEAR_SKILLS = [
  {
    name: "comments",
    minRole: "organizer",
    doc: commentsDoc,
    tools: ["create_comment", "edit_comment", "delete_comment"],
  },
  {
    name: "customer-requests",
    minRole: "organizer",
    doc: customerRequestsDoc,
    tools: ["create_customer_need", "update_customer_need", "list_customer_needs"],
  },
  {
    name: "cycles",
    minRole: "organizer",
    doc: cyclesDoc,
    tools: ["list_cycles", "get_cycle", "create_cycle", "update_cycle", "archive_cycle"],
  },
  {
    name: "documents",
    minRole: "organizer",
    doc: documentsDoc,
    tools: ["create_document", "update_document"],
  },
  {
    name: "initiative-updates",
    minRole: "organizer",
    doc: initiativeUpdatesDoc,
    tools: ["query_initiative_updates", "create_initiative_update", "update_initiative_update"],
  },
  {
    name: "initiatives",
    minRole: "organizer",
    doc: initiativesDoc,
    tools: [
      "create_initiative",
      "update_initiative",
      "list_initiatives",
      "query_initiative_activity",
    ],
  },
  {
    name: "issue-views",
    minRole: "organizer",
    doc: issueViewsDoc,
    tools: ["query_issue_view"],
  },
  {
    name: "issues",
    minRole: "organizer",
    doc: issuesDoc,
    tools: [
      "create_issue",
      "update_issue",
      "delete_issue",
      "archive_issue",
      "unarchive_issue",
      "query_issue_activity",
    ],
  },
  {
    name: "labels",
    minRole: "organizer",
    doc: labelsDoc,
    tools: ["list_labels", "get_label", "create_label", "update_label", "delete_label"],
  },
  {
    name: "membership",
    minRole: "admin",
    doc: membershipDoc,
    tools: ["add_member_to_platform", "remove_member_from_platform"],
  },
  {
    name: "project-updates",
    minRole: "organizer",
    doc: projectUpdatesDoc,
    tools: ["query_project_updates", "create_project_update", "update_project_update"],
  },
  {
    name: "project-views",
    minRole: "organizer",
    doc: projectViewsDoc,
    tools: ["query_project_view"],
  },
  {
    name: "projects",
    minRole: "organizer",
    doc: projectsDoc,
    tools: [
      "create_project",
      "update_project",
      "get_project",
      "archive_project",
      "unarchive_project",
      "delete_project",
      "create_project_milestone",
      "update_project_milestone",
      "query_project_activity",
      "query_project_view",
    ],
  },
  {
    name: "reminders",
    minRole: "organizer",
    doc: remindersDoc,
    tools: ["set_reminder"],
  },
  {
    name: "teams",
    minRole: "organizer",
    doc: teamsDoc,
    tools: ["list_team_members", "add_user_to_team", "remove_user_from_team"],
  },
  {
    name: "users",
    minRole: "organizer",
    doc: usersDoc,
    tools: [
      "list_users",
      "get_user",
      "get_user_teams",
      "get_user_assigned_issues",
      "suspend_user",
      "unsuspend_user",
      "invite_user",
      "list_invites",
      "delete_invite",
    ],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
