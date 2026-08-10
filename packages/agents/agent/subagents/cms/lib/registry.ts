/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and a Payload collection is easy to add tools
 * for without ever adding them to a skill, which leaves them unreachable.
 * `tool_defs/` mirrors the skill list exactly, and `check:capabilities` fails if
 * it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import eventsDoc from "./skill_defs/events.md" with { type: "text" };
import hackNightsDoc from "./skill_defs/hack-nights.md" with { type: "text" };
import mediaDoc from "./skill_defs/media.md" with { type: "text" };
import serviceAccountsDoc from "./skill_defs/service-accounts.md" with { type: "text" };
import showcasesDoc from "./skill_defs/showcases.md" with { type: "text" };
import usersDoc from "./skill_defs/users.md" with { type: "text" };
import { list_events } from "./tool_defs/base/list_events.ts";
import { list_hack_night_sessions } from "./tool_defs/base/list_hack_night_sessions.ts";
import { list_media } from "./tool_defs/base/list_media.ts";
import { list_shelter_projects } from "./tool_defs/base/list_shelter_projects.ts";
import { list_ugrants } from "./tool_defs/base/list_ugrants.ts";
import { create_email } from "./tool_defs/events/create_email.ts";
import { create_event } from "./tool_defs/events/create_event.ts";
import { create_rsvp } from "./tool_defs/events/create_rsvp.ts";
import { delete_email } from "./tool_defs/events/delete_email.ts";
import { delete_event } from "./tool_defs/events/delete_event.ts";
import { delete_rsvp } from "./tool_defs/events/delete_rsvp.ts";
import { get_email } from "./tool_defs/events/get_email.ts";
import { get_event } from "./tool_defs/events/get_event.ts";
import { get_rsvp } from "./tool_defs/events/get_rsvp.ts";
import { list_emails } from "./tool_defs/events/list_emails.ts";
import { list_rsvps } from "./tool_defs/events/list_rsvps.ts";
import { publish_event } from "./tool_defs/events/publish_event.ts";
import { send_blast } from "./tool_defs/events/send_blast.ts";
import { send_email } from "./tool_defs/events/send_email.ts";
import { unpublish_event } from "./tool_defs/events/unpublish_event.ts";
import { update_email } from "./tool_defs/events/update_email.ts";
import { update_event } from "./tool_defs/events/update_event.ts";
import { update_rsvp } from "./tool_defs/events/update_rsvp.ts";
import { create_hack_night_session } from "./tool_defs/hack-nights/create_hack_night_session.ts";
import { delete_hack_night_session } from "./tool_defs/hack-nights/delete_hack_night_session.ts";
import { get_hack_night_session } from "./tool_defs/hack-nights/get_hack_night_session.ts";
import { publish_hack_night_session } from "./tool_defs/hack-nights/publish_hack_night_session.ts";
import { unpublish_hack_night_session } from "./tool_defs/hack-nights/unpublish_hack_night_session.ts";
import { update_hack_night_session } from "./tool_defs/hack-nights/update_hack_night_session.ts";
import { delete_media } from "./tool_defs/media/delete_media.ts";
import { get_media } from "./tool_defs/media/get_media.ts";
import { upload_media } from "./tool_defs/media/upload_media.ts";
import { create_service_account } from "./tool_defs/service-accounts/create_service_account.ts";
import { delete_service_account } from "./tool_defs/service-accounts/delete_service_account.ts";
import { get_service_account } from "./tool_defs/service-accounts/get_service_account.ts";
import { list_service_accounts } from "./tool_defs/service-accounts/list_service_accounts.ts";
import { update_service_account } from "./tool_defs/service-accounts/update_service_account.ts";
import { create_shelter_project } from "./tool_defs/showcases/create_shelter_project.ts";
import { create_ugrant } from "./tool_defs/showcases/create_ugrant.ts";
import { delete_shelter_project } from "./tool_defs/showcases/delete_shelter_project.ts";
import { delete_ugrant } from "./tool_defs/showcases/delete_ugrant.ts";
import { get_shelter_project } from "./tool_defs/showcases/get_shelter_project.ts";
import { get_ugrant } from "./tool_defs/showcases/get_ugrant.ts";
import { publish_shelter_project } from "./tool_defs/showcases/publish_shelter_project.ts";
import { publish_ugrant } from "./tool_defs/showcases/publish_ugrant.ts";
import { unpublish_shelter_project } from "./tool_defs/showcases/unpublish_shelter_project.ts";
import { unpublish_ugrant } from "./tool_defs/showcases/unpublish_ugrant.ts";
import { update_shelter_project } from "./tool_defs/showcases/update_shelter_project.ts";
import { update_ugrant } from "./tool_defs/showcases/update_ugrant.ts";
import { create_user } from "./tool_defs/users/create_user.ts";
import { delete_user } from "./tool_defs/users/delete_user.ts";
import { get_user } from "./tool_defs/users/get_user.ts";
import { list_users } from "./tool_defs/users/list_users.ts";
import { update_user } from "./tool_defs/users/update_user.ts";

export const CMS_TOOLS = {
  create_email,
  create_event,
  create_hack_night_session,
  create_rsvp,
  create_service_account,
  create_shelter_project,
  create_ugrant,
  create_user,
  delete_email,
  delete_event,
  delete_hack_night_session,
  delete_media,
  delete_rsvp,
  delete_service_account,
  delete_shelter_project,
  delete_ugrant,
  delete_user,
  get_email,
  get_event,
  get_hack_night_session,
  get_media,
  get_rsvp,
  get_service_account,
  get_shelter_project,
  get_ugrant,
  get_user,
  list_emails,
  list_events,
  list_hack_night_sessions,
  list_media,
  list_rsvps,
  list_service_accounts,
  list_shelter_projects,
  list_ugrants,
  list_users,
  publish_event,
  publish_hack_night_session,
  publish_shelter_project,
  publish_ugrant,
  send_blast,
  send_email,
  unpublish_event,
  unpublish_hack_night_session,
  unpublish_shelter_project,
  unpublish_ugrant,
  update_email,
  update_event,
  update_hack_night_session,
  update_rsvp,
  update_service_account,
  update_shelter_project,
  update_ugrant,
  update_user,
  upload_media,
} as const satisfies Record<string, DomainToolSpec>;

export type CmsToolName = keyof typeof CMS_TOOLS;

export const CMS_BASE_TOOL_NAMES = [
  "list_events",
  "list_hack_night_sessions",
  "list_ugrants",
  "list_shelter_projects",
  "list_media",
] as const;

export const CMS_SKILLS = [
  {
    name: "events",
    minRole: "organizer",
    doc: eventsDoc,
    tools: [
      "list_events",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
      "publish_event",
      "unpublish_event",
      "send_blast",
      "list_rsvps",
      "get_rsvp",
      "create_rsvp",
      "update_rsvp",
      "delete_rsvp",
      "list_emails",
      "get_email",
      "create_email",
      "update_email",
      "delete_email",
      "send_email",
    ],
  },
  {
    name: "hack-nights",
    minRole: "organizer",
    doc: hackNightsDoc,
    tools: [
      "list_hack_night_sessions",
      "get_hack_night_session",
      "create_hack_night_session",
      "update_hack_night_session",
      "delete_hack_night_session",
      "publish_hack_night_session",
      "unpublish_hack_night_session",
    ],
  },
  {
    name: "media",
    minRole: "organizer",
    doc: mediaDoc,
    tools: ["list_media", "get_media", "upload_media", "delete_media"],
  },
  {
    name: "service-accounts",
    minRole: "organizer",
    doc: serviceAccountsDoc,
    tools: [
      "list_service_accounts",
      "get_service_account",
      "create_service_account",
      "update_service_account",
      "delete_service_account",
    ],
  },
  {
    name: "showcases",
    minRole: "organizer",
    doc: showcasesDoc,
    tools: [
      "list_ugrants",
      "get_ugrant",
      "create_ugrant",
      "update_ugrant",
      "delete_ugrant",
      "publish_ugrant",
      "unpublish_ugrant",
      "list_shelter_projects",
      "get_shelter_project",
      "create_shelter_project",
      "update_shelter_project",
      "delete_shelter_project",
      "publish_shelter_project",
      "unpublish_shelter_project",
    ],
  },
  {
    name: "users",
    minRole: "admin",
    doc: usersDoc,
    tools: ["list_users", "get_user", "create_user", "update_user", "delete_user"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];
