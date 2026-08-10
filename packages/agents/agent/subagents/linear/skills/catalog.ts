import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import commentsDoc from "../lib/skill_defs/comments.md" with { type: "text" };
import customerRequestsDoc from "../lib/skill_defs/customer-requests.md" with { type: "text" };
import cyclesDoc from "../lib/skill_defs/cycles.md" with { type: "text" };
import documentsDoc from "../lib/skill_defs/documents.md" with { type: "text" };
import initiativeUpdatesDoc from "../lib/skill_defs/initiative-updates.md" with { type: "text" };
import initiativesDoc from "../lib/skill_defs/initiatives.md" with { type: "text" };
import issueViewsDoc from "../lib/skill_defs/issue-views.md" with { type: "text" };
import issuesDoc from "../lib/skill_defs/issues.md" with { type: "text" };
import labelsDoc from "../lib/skill_defs/labels.md" with { type: "text" };
import membershipDoc from "../lib/skill_defs/membership.md" with { type: "text" };
import projectUpdatesDoc from "../lib/skill_defs/project-updates.md" with { type: "text" };
import projectViewsDoc from "../lib/skill_defs/project-views.md" with { type: "text" };
import projectsDoc from "../lib/skill_defs/projects.md" with { type: "text" };
import remindersDoc from "../lib/skill_defs/reminders.md" with { type: "text" };
import teamsDoc from "../lib/skill_defs/teams.md" with { type: "text" };
import usersDoc from "../lib/skill_defs/users.md" with { type: "text" };

export const LINEAR_BASE_TOOL_NAMES = [
  "search_entities",
  "retrieve_entities",
  "suggest_property_values",
  "aggregate_issues",
] as const;

export const LINEAR_SKILL_DEFINITIONS = [
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, LINEAR_SKILL_DEFINITIONS),
  },
});
