import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";
import auditLogDoc from "../lib/skill_defs/audit-log.md" with { type: "text" };
import autoModerationDoc from "../lib/skill_defs/auto-moderation.md" with { type: "text" };
import channelsDoc from "../lib/skill_defs/channels.md" with { type: "text" };
import emojisDoc from "../lib/skill_defs/emojis.md" with { type: "text" };
import eventsDoc from "../lib/skill_defs/events.md" with { type: "text" };
import guildDoc from "../lib/skill_defs/guild.md" with { type: "text" };
import invitesDoc from "../lib/skill_defs/invites.md" with { type: "text" };
import memberManagementDoc from "../lib/skill_defs/member-management.md" with { type: "text" };
import membersDoc from "../lib/skill_defs/members.md" with { type: "text" };
import membershipDoc from "../lib/skill_defs/membership.md" with { type: "text" };
import messagesDoc from "../lib/skill_defs/messages.md" with { type: "text" };
import rolesDoc from "../lib/skill_defs/roles.md" with { type: "text" };
import threadsDoc from "../lib/skill_defs/threads.md" with { type: "text" };
import webhooksDoc from "../lib/skill_defs/webhooks.md" with { type: "text" };

export const DISCORD_BASE_TOOL_NAMES = [
  "get_server_info",
  "list_channels",
  "list_roles",
  "search_members",
] as const;

export const DISCORD_SKILL_DEFINITIONS = [
  {
    name: "audit-log",
    minRole: "organizer",
    doc: auditLogDoc,
    tools: ["get_audit_log"],
  },
  {
    name: "auto-moderation",
    minRole: "organizer",
    doc: autoModerationDoc,
    tools: [
      "list_auto_mod_rules",
      "get_auto_mod_rule",
      "create_auto_mod_rule",
      "update_auto_mod_rule",
      "delete_auto_mod_rule",
    ],
  },
  {
    name: "channels",
    minRole: "organizer",
    doc: channelsDoc,
    tools: [
      "create_channel",
      "edit_channel",
      "delete_channel",
      "get_channel",
      "follow_announcement_channel",
    ],
  },
  {
    name: "emojis",
    minRole: "organizer",
    doc: emojisDoc,
    tools: [
      "list_emojis",
      "create_emoji",
      "edit_emoji",
      "delete_emoji",
      "list_stickers",
      "create_sticker",
      "edit_sticker",
      "delete_sticker",
    ],
  },
  {
    name: "events",
    minRole: "organizer",
    doc: eventsDoc,
    tools: ["list_events", "create_event", "edit_event", "delete_event"],
  },
  {
    name: "guild",
    minRole: "admin",
    doc: guildDoc,
    tools: ["update_guild", "get_guild_preview", "get_vanity_url"],
  },
  {
    name: "invites",
    minRole: "admin",
    doc: invitesDoc,
    tools: ["list_invites", "create_invite", "delete_invite"],
  },
  {
    name: "member-management",
    minRole: "admin",
    doc: memberManagementDoc,
    tools: [
      "ban_member",
      "unban_member",
      "list_bans",
      "kick_member",
      "timeout_member",
      "clear_timeout",
    ],
  },
  {
    name: "members",
    minRole: "organizer",
    doc: membersDoc,
    tools: ["get_member", "set_nickname"],
  },
  {
    name: "membership",
    minRole: "admin",
    doc: membershipDoc,
    tools: ["add_member_to_platform", "remove_member_from_platform"],
  },
  {
    name: "messages",
    minRole: "organizer",
    doc: messagesDoc,
    tools: [
      "send_message",
      "delete_message",
      "edit_message",
      "bulk_delete_messages",
      "crosspost_message",
      "get_message",
      "pin_message",
      "unpin_message",
      "add_reaction",
      "remove_reaction",
      "remove_all_reactions",
      "fetch_messages",
    ],
  },
  {
    name: "roles",
    minRole: "organizer",
    doc: rolesDoc,
    tools: ["create_role", "edit_role", "delete_role", "assign_role", "remove_role"],
  },
  {
    name: "threads",
    minRole: "organizer",
    doc: threadsDoc,
    tools: ["list_threads", "create_thread", "edit_thread", "delete_thread"],
  },
  {
    name: "webhooks",
    minRole: "organizer",
    doc: webhooksDoc,
    tools: ["list_webhooks", "create_webhook", "delete_webhook", "edit_webhook"],
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, DISCORD_SKILL_DEFINITIONS),
  },
});
