import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import eventsDoc from "../lib/skill_defs/events.md" with { type: "text" };
import hackNightsDoc from "../lib/skill_defs/hack-nights.md" with { type: "text" };
import mediaDoc from "../lib/skill_defs/media.md" with { type: "text" };
import serviceAccountsDoc from "../lib/skill_defs/service-accounts.md" with { type: "text" };
import showcasesDoc from "../lib/skill_defs/showcases.md" with { type: "text" };
import usersDoc from "../lib/skill_defs/users.md" with { type: "text" };

export const CMS_BASE_TOOL_NAMES = [
  "list_events",
  "list_hack_night_sessions",
  "list_ugrants",
  "list_shelter_projects",
  "list_media",
] as const;

export const CMS_SKILL_DEFINITIONS = [
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

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, CMS_SKILL_DEFINITIONS),
  },
});
