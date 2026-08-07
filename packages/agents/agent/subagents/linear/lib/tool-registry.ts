import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import * as m_base from "./base.ts";
import * as m_comments from "./comments.ts";
import * as m_customer_requests from "./customer-requests.ts";
import * as m_cycles from "./cycles.ts";
import * as m_documents from "./documents.ts";
import * as m_initiative_updates from "./initiative-updates.ts";
import * as m_initiatives from "./initiatives.ts";
import * as m_issue_views from "./issue-views.ts";
import * as m_issues from "./issues.ts";
import * as m_labels from "./labels.ts";
import * as m_membership from "./membership.ts";
import * as m_project_updates from "./project-updates.ts";
import * as m_project_views from "./project-views.ts";
import * as m_projects from "./projects.ts";
import * as m_reminders from "./reminders.ts";
import * as m_teams from "./teams.ts";
import * as m_users from "./users.ts";

export const LINEAR_TOOLS = {
  search_entities: m_base.search_entities,
  retrieve_entities: m_base.retrieve_entities,
  suggest_property_values: m_base.suggest_property_values,
  aggregate_issues: m_base.aggregate_issues,
  create_comment: m_comments.create_comment,
  edit_comment: m_comments.edit_comment,
  delete_comment: m_comments.delete_comment,
  create_customer_need: m_customer_requests.create_customer_need,
  update_customer_need: m_customer_requests.update_customer_need,
  list_customer_needs: m_customer_requests.list_customer_needs,
  list_cycles: m_cycles.list_cycles,
  get_cycle: m_cycles.get_cycle,
  create_cycle: m_cycles.create_cycle,
  update_cycle: m_cycles.update_cycle,
  archive_cycle: m_cycles.archive_cycle,
  create_document: m_documents.create_document,
  update_document: m_documents.update_document,
  query_initiative_updates: m_initiative_updates.query_initiative_updates,
  create_initiative_update: m_initiative_updates.create_initiative_update,
  update_initiative_update: m_initiative_updates.update_initiative_update,
  create_initiative: m_initiatives.create_initiative,
  update_initiative: m_initiatives.update_initiative,
  list_initiatives: m_initiatives.list_initiatives,
  query_initiative_activity: m_initiatives.query_initiative_activity,
  query_issue_view: m_issue_views.query_issue_view,
  create_issue: m_issues.create_issue,
  update_issue: m_issues.update_issue,
  delete_issue: m_issues.delete_issue,
  archive_issue: m_issues.archive_issue,
  unarchive_issue: m_issues.unarchive_issue,
  query_issue_activity: m_issues.query_issue_activity,
  list_labels: m_labels.list_labels,
  get_label: m_labels.get_label,
  create_label: m_labels.create_label,
  update_label: m_labels.update_label,
  delete_label: m_labels.delete_label,
  add_member_to_platform: m_membership.add_member_to_platform,
  remove_member_from_platform: m_membership.remove_member_from_platform,
  query_project_updates: m_project_updates.query_project_updates,
  create_project_update: m_project_updates.create_project_update,
  update_project_update: m_project_updates.update_project_update,
  query_project_view: m_project_views.query_project_view,
  create_project: m_projects.create_project,
  update_project: m_projects.update_project,
  create_project_milestone: m_projects.create_project_milestone,
  update_project_milestone: m_projects.update_project_milestone,
  get_project: m_projects.get_project,
  archive_project: m_projects.archive_project,
  unarchive_project: m_projects.unarchive_project,
  delete_project: m_projects.delete_project,
  query_project_activity: m_projects.query_project_activity,
  set_reminder: m_reminders.set_reminder,
  list_team_members: m_teams.list_team_members,
  add_user_to_team: m_teams.add_user_to_team,
  remove_user_from_team: m_teams.remove_user_from_team,
  list_users: m_users.list_users,
  get_user: m_users.get_user,
  get_user_teams: m_users.get_user_teams,
  get_user_assigned_issues: m_users.get_user_assigned_issues,
  suspend_user: m_users.suspend_user,
  unsuspend_user: m_users.unsuspend_user,
  invite_user: m_users.invite_user,
  list_invites: m_users.list_invites,
  delete_invite: m_users.delete_invite,
} as const satisfies Record<string, DomainToolSpec>;

export type LinearToolName = keyof typeof LINEAR_TOOLS;
