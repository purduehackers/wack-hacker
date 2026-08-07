import type { CmsToolSpec } from "./define-tool.ts";
import * as m_emails from "./emails.ts";
import * as m_events from "./events.ts";
import * as m_hack_night_sessions from "./hack_night_sessions.ts";
import * as m_media from "./media.ts";
import * as m_rsvps from "./rsvps.ts";
import * as m_service_accounts from "./service_accounts.ts";
import * as m_shelter_projects from "./shelter_projects.ts";
import * as m_ugrants from "./ugrants.ts";
import * as m_users from "./users.ts";

export const CMS_TOOLS = {
  list_events: m_events.list_events,
  get_event: m_events.get_event,
  create_event: m_events.create_event,
  update_event: m_events.update_event,
  delete_event: m_events.delete_event,
  publish_event: m_events.publish_event,
  unpublish_event: m_events.unpublish_event,
  send_blast: m_events.send_blast,
  list_rsvps: m_rsvps.list_rsvps,
  get_rsvp: m_rsvps.get_rsvp,
  create_rsvp: m_rsvps.create_rsvp,
  update_rsvp: m_rsvps.update_rsvp,
  delete_rsvp: m_rsvps.delete_rsvp,
  list_emails: m_emails.list_emails,
  get_email: m_emails.get_email,
  create_email: m_emails.create_email,
  update_email: m_emails.update_email,
  delete_email: m_emails.delete_email,
  send_email: m_emails.send_email,
  list_hack_night_sessions: m_hack_night_sessions.list_hack_night_sessions,
  get_hack_night_session: m_hack_night_sessions.get_hack_night_session,
  create_hack_night_session: m_hack_night_sessions.create_hack_night_session,
  update_hack_night_session: m_hack_night_sessions.update_hack_night_session,
  delete_hack_night_session: m_hack_night_sessions.delete_hack_night_session,
  publish_hack_night_session: m_hack_night_sessions.publish_hack_night_session,
  unpublish_hack_night_session: m_hack_night_sessions.unpublish_hack_night_session,
  list_media: m_media.list_media,
  get_media: m_media.get_media,
  upload_media: m_media.upload_media,
  delete_media: m_media.delete_media,
  list_ugrants: m_ugrants.list_ugrants,
  get_ugrant: m_ugrants.get_ugrant,
  create_ugrant: m_ugrants.create_ugrant,
  update_ugrant: m_ugrants.update_ugrant,
  delete_ugrant: m_ugrants.delete_ugrant,
  publish_ugrant: m_ugrants.publish_ugrant,
  unpublish_ugrant: m_ugrants.unpublish_ugrant,
  list_shelter_projects: m_shelter_projects.list_shelter_projects,
  get_shelter_project: m_shelter_projects.get_shelter_project,
  create_shelter_project: m_shelter_projects.create_shelter_project,
  update_shelter_project: m_shelter_projects.update_shelter_project,
  delete_shelter_project: m_shelter_projects.delete_shelter_project,
  publish_shelter_project: m_shelter_projects.publish_shelter_project,
  unpublish_shelter_project: m_shelter_projects.unpublish_shelter_project,
  list_users: m_users.list_users,
  get_user: m_users.get_user,
  create_user: m_users.create_user,
  update_user: m_users.update_user,
  delete_user: m_users.delete_user,
  list_service_accounts: m_service_accounts.list_service_accounts,
  get_service_account: m_service_accounts.get_service_account,
  create_service_account: m_service_accounts.create_service_account,
  update_service_account: m_service_accounts.update_service_account,
  delete_service_account: m_service_accounts.delete_service_account,
} as const satisfies Record<string, CmsToolSpec>;

export type CmsToolName = keyof typeof CMS_TOOLS;
