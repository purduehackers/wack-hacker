/**
 * Every tool and skill this domain declares.
 *
 * One registry rather than a tool map here and a skill catalog there: the two
 * are the same fact seen twice, and splitting them is what let five grouped
 * operation modules accumulate 68 tools whose membership no single file stated.
 * `tool_defs/` mirrors the skill list exactly, and `check:capabilities` fails if
 * it stops doing so.
 *
 * Skill prose lives in `lib/skill_defs/<name>.md` and is imported as text, so the
 * markdown is a real document while policy stays here next to the tools.
 */

import type { DomainToolSpec } from "../../../lib/policy/domain-tools.ts";
import type { IntegrationSkillDefinition } from "../../../lib/policy/skill-catalog.ts";
import auditLogDoc from "./skill_defs/audit-log.md" with { type: "text" };
import autoModerationDoc from "./skill_defs/auto-moderation.md" with { type: "text" };
import channelsDoc from "./skill_defs/channels.md" with { type: "text" };
import emojisDoc from "./skill_defs/emojis.md" with { type: "text" };
import eventsDoc from "./skill_defs/events.md" with { type: "text" };
import guildDoc from "./skill_defs/guild.md" with { type: "text" };
import invitesDoc from "./skill_defs/invites.md" with { type: "text" };
import memberManagementDoc from "./skill_defs/member-management.md" with { type: "text" };
import membersDoc from "./skill_defs/members.md" with { type: "text" };
import membershipDoc from "./skill_defs/membership.md" with { type: "text" };
import messagesDoc from "./skill_defs/messages.md" with { type: "text" };
import rolesDoc from "./skill_defs/roles.md" with { type: "text" };
import threadsDoc from "./skill_defs/threads.md" with { type: "text" };
import webhooksDoc from "./skill_defs/webhooks.md" with { type: "text" };
import { get_audit_log } from "./tool_defs/audit-log/get_audit_log.ts";
import { create_auto_mod_rule } from "./tool_defs/auto-moderation/create_auto_mod_rule.ts";
import { delete_auto_mod_rule } from "./tool_defs/auto-moderation/delete_auto_mod_rule.ts";
import { get_auto_mod_rule } from "./tool_defs/auto-moderation/get_auto_mod_rule.ts";
import { list_auto_mod_rules } from "./tool_defs/auto-moderation/list_auto_mod_rules.ts";
import { update_auto_mod_rule } from "./tool_defs/auto-moderation/update_auto_mod_rule.ts";
import { get_server_info } from "./tool_defs/base/get_server_info.ts";
import { list_channels } from "./tool_defs/base/list_channels.ts";
import { list_roles } from "./tool_defs/base/list_roles.ts";
import { search_members } from "./tool_defs/base/search_members.ts";
import { create_channel } from "./tool_defs/channels/create_channel.ts";
import { delete_channel } from "./tool_defs/channels/delete_channel.ts";
import { edit_channel } from "./tool_defs/channels/edit_channel.ts";
import { follow_announcement_channel } from "./tool_defs/channels/follow_announcement_channel.ts";
import { get_channel } from "./tool_defs/channels/get_channel.ts";
import { create_emoji } from "./tool_defs/emojis/create_emoji.ts";
import { create_sticker } from "./tool_defs/emojis/create_sticker.ts";
import { delete_emoji } from "./tool_defs/emojis/delete_emoji.ts";
import { delete_sticker } from "./tool_defs/emojis/delete_sticker.ts";
import { edit_emoji } from "./tool_defs/emojis/edit_emoji.ts";
import { edit_sticker } from "./tool_defs/emojis/edit_sticker.ts";
import { list_emojis } from "./tool_defs/emojis/list_emojis.ts";
import { list_stickers } from "./tool_defs/emojis/list_stickers.ts";
import { create_event } from "./tool_defs/events/create_event.ts";
import { delete_event } from "./tool_defs/events/delete_event.ts";
import { edit_event } from "./tool_defs/events/edit_event.ts";
import { list_events } from "./tool_defs/events/list_events.ts";
import { get_guild_preview } from "./tool_defs/guild/get_guild_preview.ts";
import { get_vanity_url } from "./tool_defs/guild/get_vanity_url.ts";
import { update_guild } from "./tool_defs/guild/update_guild.ts";
import { create_invite } from "./tool_defs/invites/create_invite.ts";
import { delete_invite } from "./tool_defs/invites/delete_invite.ts";
import { list_invites } from "./tool_defs/invites/list_invites.ts";
import { ban_member } from "./tool_defs/member-management/ban_member.ts";
import { clear_timeout } from "./tool_defs/member-management/clear_timeout.ts";
import { kick_member } from "./tool_defs/member-management/kick_member.ts";
import { list_bans } from "./tool_defs/member-management/list_bans.ts";
import { timeout_member } from "./tool_defs/member-management/timeout_member.ts";
import { unban_member } from "./tool_defs/member-management/unban_member.ts";
import { get_member } from "./tool_defs/members/get_member.ts";
import { set_nickname } from "./tool_defs/members/set_nickname.ts";
import { add_member_to_platform } from "./tool_defs/membership/add_member_to_platform.ts";
import { remove_member_from_platform } from "./tool_defs/membership/remove_member_from_platform.ts";
import { add_reaction } from "./tool_defs/messages/add_reaction.ts";
import { bulk_delete_messages } from "./tool_defs/messages/bulk_delete_messages.ts";
import { crosspost_message } from "./tool_defs/messages/crosspost_message.ts";
import { delete_message } from "./tool_defs/messages/delete_message.ts";
import { edit_message } from "./tool_defs/messages/edit_message.ts";
import { fetch_messages } from "./tool_defs/messages/fetch_messages.ts";
import { get_message } from "./tool_defs/messages/get_message.ts";
import { pin_message } from "./tool_defs/messages/pin_message.ts";
import { remove_all_reactions } from "./tool_defs/messages/remove_all_reactions.ts";
import { remove_reaction } from "./tool_defs/messages/remove_reaction.ts";
import { send_message } from "./tool_defs/messages/send_message.ts";
import { unpin_message } from "./tool_defs/messages/unpin_message.ts";
import { assign_role } from "./tool_defs/roles/assign_role.ts";
import { create_role } from "./tool_defs/roles/create_role.ts";
import { delete_role } from "./tool_defs/roles/delete_role.ts";
import { edit_role } from "./tool_defs/roles/edit_role.ts";
import { remove_role } from "./tool_defs/roles/remove_role.ts";
import { create_thread } from "./tool_defs/threads/create_thread.ts";
import { delete_thread } from "./tool_defs/threads/delete_thread.ts";
import { edit_thread } from "./tool_defs/threads/edit_thread.ts";
import { list_threads } from "./tool_defs/threads/list_threads.ts";
import { create_webhook } from "./tool_defs/webhooks/create_webhook.ts";
import { delete_webhook } from "./tool_defs/webhooks/delete_webhook.ts";
import { edit_webhook } from "./tool_defs/webhooks/edit_webhook.ts";
import { list_webhooks } from "./tool_defs/webhooks/list_webhooks.ts";

export const DISCORD_TOOLS = {
  add_member_to_platform,
  add_reaction,
  assign_role,
  ban_member,
  bulk_delete_messages,
  clear_timeout,
  create_auto_mod_rule,
  create_channel,
  create_emoji,
  create_event,
  create_invite,
  create_role,
  create_sticker,
  create_thread,
  create_webhook,
  crosspost_message,
  delete_auto_mod_rule,
  delete_channel,
  delete_emoji,
  delete_event,
  delete_invite,
  delete_message,
  delete_role,
  delete_sticker,
  delete_thread,
  delete_webhook,
  edit_channel,
  edit_emoji,
  edit_event,
  edit_message,
  edit_role,
  edit_sticker,
  edit_thread,
  edit_webhook,
  fetch_messages,
  follow_announcement_channel,
  get_audit_log,
  get_auto_mod_rule,
  get_channel,
  get_guild_preview,
  get_member,
  get_message,
  get_server_info,
  get_vanity_url,
  kick_member,
  list_auto_mod_rules,
  list_bans,
  list_channels,
  list_emojis,
  list_events,
  list_invites,
  list_roles,
  list_stickers,
  list_threads,
  list_webhooks,
  pin_message,
  remove_all_reactions,
  remove_member_from_platform,
  remove_reaction,
  remove_role,
  search_members,
  send_message,
  set_nickname,
  timeout_member,
  unban_member,
  unpin_message,
  update_auto_mod_rule,
  update_guild,
} as const satisfies Record<string, DomainToolSpec>;

export type DiscordToolName = keyof typeof DISCORD_TOOLS;

export const DISCORD_BASE_TOOL_NAMES = [
  "get_server_info",
  "list_channels",
  "list_roles",
  "search_members",
] as const;

export const DISCORD_SKILLS = [
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
