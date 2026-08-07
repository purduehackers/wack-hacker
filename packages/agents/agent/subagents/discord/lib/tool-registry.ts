import { DISCORD_COMMAND_INPUT_SCHEMAS } from "@repo/shared/discord-command-wire";
import { Result } from "@repo/shared/result";

import { discordCommand } from "./client.ts";
import { defineTool, type DiscordToolSpec } from "./define-tool.ts";

export const DISCORD_TOOLS = {
  get_audit_log: defineTool({
    name: "get_audit_log",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get the Discord server's audit log. Use to find who performed admin actions (role changes, bans, channel edits, etc.). Returns entries with action type, executor, target, timestamps, and optional reason. Supports pagination and filtering by user/action type.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_audit_log,
    execute: async (input) => {
      const outcome = await discordCommand("get_audit_log", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_auto_mod_rules: defineTool({
    name: "list_auto_mod_rules",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all auto-moderation rules in the Discord server. Returns rule ID, name, trigger type (keyword, spam, mention, etc.), actions, and enabled status.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_auto_mod_rules,
    execute: async (input) => {
      const outcome = await discordCommand("list_auto_mod_rules", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_auto_mod_rule: defineTool({
    name: "get_auto_mod_rule",
    domain: "discord",
    access: { risk: "read" },
    description: "Get full details for a single auto-moderation rule by ID.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_auto_mod_rule,
    execute: async (input) => {
      const outcome = await discordCommand("get_auto_mod_rule", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_auto_mod_rule: defineTool({
    name: "create_auto_mod_rule",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Create an auto-moderation rule. trigger_type: 1=keyword, 3=spam, 4=keyword_preset, 5=mention_spam, 6=member_profile. event_type is 1=message_send or 2=member_update.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_auto_mod_rule,
    execute: async (input) => {
      const outcome = await discordCommand("create_auto_mod_rule", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  update_auto_mod_rule: defineTool({
    name: "update_auto_mod_rule",
    domain: "discord",
    access: { risk: "destructive" },
    description: "Update an auto-moderation rule's name, trigger, actions, or enabled status.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.update_auto_mod_rule,
    execute: async (input) => {
      const outcome = await discordCommand("update_auto_mod_rule", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_auto_mod_rule: defineTool({
    name: "delete_auto_mod_rule",
    domain: "discord",
    access: { risk: "destructive" },
    description: "Delete an auto-moderation rule. Cannot be undone.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_auto_mod_rule,
    execute: async (input) => {
      const outcome = await discordCommand("delete_auto_mod_rule", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_server_info: defineTool({
    name: "get_server_info",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get Discord server overview: name, member count, channel count, role count, and basic settings. Use this to understand the server at a high level.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_server_info,
    execute: async (input) => {
      const outcome = await discordCommand("get_server_info", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_channels: defineTool({
    name: "list_channels",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all channels in the Discord server, organized by category. Returns channel IDs, names, types, topics, and positions. Use this to find the right channel before sending messages or performing channel operations.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_channels,
    execute: async (input) => {
      const outcome = await discordCommand("list_channels", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_roles: defineTool({
    name: "list_roles",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all roles in the Discord server with their colors, positions, and whether they are hoisted or mentionable. Use this to find role IDs before assigning or managing roles.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_roles,
    execute: async (input) => {
      const outcome = await discordCommand("list_roles", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  search_members: defineTool({
    name: "search_members",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Search for server members by name, nickname, or user ID. Returns member info including roles, join date, and display name. Use this to find a user before performing member operations.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.search_members,
    execute: async (input) => {
      const outcome = await discordCommand("search_members", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_channel: defineTool({
    name: "create_channel",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Create a new channel in the Discord server. Supports text, voice, category, announcement, forum, and stage channel types. Returns the created channel's details.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_channel,
    execute: async (input) => {
      const outcome = await discordCommand("create_channel", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_channel: defineTool({
    name: "edit_channel",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Edit an existing channel's settings such as name, topic, slowmode, position, NSFW flag, parent category, and voice-specific settings.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_channel,
    execute: async (input) => {
      const outcome = await discordCommand("edit_channel", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_channel: defineTool({
    name: "get_channel",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get a single channel's details by ID. Returns type, name, topic, position, parent category, and other settings.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_channel,
    execute: async (input) => {
      const outcome = await discordCommand("get_channel", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  follow_announcement_channel: defineTool({
    name: "follow_announcement_channel",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Follow an announcement channel — its messages will be auto-crossposted to the target channel in this server. Only announcement channels can be followed.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.follow_announcement_channel,
    execute: async (input) => {
      const outcome = await discordCommand("follow_announcement_channel", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_channel: defineTool({
    name: "delete_channel",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a channel from the server. This is irreversible and will permanently remove the channel and all its messages.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_channel,
    execute: async (input) => {
      const outcome = await discordCommand("delete_channel", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_emojis: defineTool({
    name: "list_emojis",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all custom emojis in the server. Returns emoji IDs, names, animation status, image URLs, and role restrictions.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_emojis,
    execute: async (input) => {
      const outcome = await discordCommand("list_emojis", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_emoji: defineTool({
    name: "create_emoji",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Create a custom emoji from an image URL. The image must be PNG, JPG, or GIF and under 256KB. You can restrict usage to specific roles.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_emoji,
    execute: async (input) => {
      const outcome = await discordCommand("create_emoji", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_emoji: defineTool({
    name: "edit_emoji",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Edit a custom emoji's name or role restrictions. Pass an empty roles array to make the emoji available to everyone.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_emoji,
    execute: async (input) => {
      const outcome = await discordCommand("edit_emoji", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_emoji: defineTool({
    name: "delete_emoji",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a custom emoji. This is irreversible and will remove the emoji from all messages where it was used (they will show as unknown emoji).",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_emoji,
    execute: async (input) => {
      const outcome = await discordCommand("delete_emoji", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_events: defineTool({
    name: "list_events",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all scheduled events in the server. Returns event details including name, description, times, type, location, and attendee count.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_events,
    execute: async (input) => {
      const outcome = await discordCommand("list_events", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_event: defineTool({
    name: "create_event",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Create a scheduled event in the server. Supports voice channel events, stage events, and external (location-based) events. External events require an end time and location.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_event,
    execute: async (input) => {
      const outcome = await discordCommand("create_event", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_event: defineTool({
    name: "edit_event",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Edit a scheduled event's name, description, times, location, image, status, or channel. Use status to start ('active'), end ('completed'), or cancel ('canceled') an event.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_event,
    execute: async (input) => {
      const outcome = await discordCommand("edit_event", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_event: defineTool({
    name: "delete_event",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a scheduled event. This is irreversible and will notify users who have indicated interest.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_event,
    execute: async (input) => {
      const outcome = await discordCommand("delete_event", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  update_guild: defineTool({
    name: "update_guild",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Update core Discord server settings — name, description, icon, banner, afk channel, verification level, etc. Only provide the fields you want to change.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.update_guild,
    execute: async (input) => {
      const outcome = await discordCommand("update_guild", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_guild_preview: defineTool({
    name: "get_guild_preview",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get public preview info for the Discord server — approximate member count, online count, description, features, and splash image.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_guild_preview,
    execute: async (input) => {
      const outcome = await discordCommand("get_guild_preview", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_vanity_url: defineTool({
    name: "get_vanity_url",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get the Discord server's vanity invite URL (e.g. discord.gg/purduehackers) if one is configured. Returns code and usage count.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_vanity_url,
    execute: async (input) => {
      const outcome = await discordCommand("get_vanity_url", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_invites: defineTool({
    name: "list_invites",
    domain: "discord",
    access: { risk: "read", minRole: "admin" },
    description:
      "List all active server invites with their codes, channels, creators, usage counts, and expiry dates.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_invites,
    execute: async (input) => {
      const outcome = await discordCommand("list_invites", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_invite: defineTool({
    name: "create_invite",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Create a new server invite for a specific channel. Returns the invite code and URL.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_invite,
    execute: async (input) => {
      const outcome = await discordCommand("create_invite", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_invite: defineTool({
    name: "delete_invite",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Revoke an active invite by its code. Use list_invites first to find available codes.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_invite,
    execute: async (input) => {
      const outcome = await discordCommand("delete_invite", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  ban_member: defineTool({
    name: "ban_member",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
    description:
      "Ban a member from the Discord server. They cannot rejoin until unbanned. Optionally delete the last N seconds of their messages (0-604800, 0 by default).",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.ban_member,
    execute: async (input) => {
      const outcome = await discordCommand("ban_member", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  unban_member: defineTool({
    name: "unban_member",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description: "Remove a ban for a Discord user, allowing them to rejoin the server.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.unban_member,
    execute: async (input) => {
      const outcome = await discordCommand("unban_member", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_bans: defineTool({
    name: "list_bans",
    domain: "discord",
    access: { risk: "read", minRole: "admin" },
    description:
      "List banned users in the Discord server. Returns user ID, username, and ban reason. Paginated via before/after cursors (snowflake IDs).",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_bans,
    execute: async (input) => {
      const outcome = await discordCommand("list_bans", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  kick_member: defineTool({
    name: "kick_member",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin", confirm: "second-party" },
    description:
      "Kick a member from the Discord server. They can rejoin via a new invite. For permanent removal, use ban_member instead.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.kick_member,
    execute: async (input) => {
      const outcome = await discordCommand("kick_member", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  timeout_member: defineTool({
    name: "timeout_member",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Timeout a member. They cannot send messages, react, speak, or join voice until the timeout expires. Max duration is 28 days.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.timeout_member,
    execute: async (input) => {
      const outcome = await discordCommand("timeout_member", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  clear_timeout: defineTool({
    name: "clear_timeout",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Clear an active timeout on a member, restoring their ability to talk immediately.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.clear_timeout,
    execute: async (input) => {
      const outcome = await discordCommand("clear_timeout", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_member: defineTool({
    name: "get_member",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get detailed information about a server member including their roles, join date, nickname, avatar, and boost status. Use search_members first if you only have a name.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_member,
    execute: async (input) => {
      const outcome = await discordCommand("get_member", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  set_nickname: defineTool({
    name: "set_nickname",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Set or clear a member's server nickname. Pass null to clear the nickname and revert to their username.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.set_nickname,
    execute: async (input) => {
      const outcome = await discordCommand("set_nickname", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  add_member_to_platform: defineTool({
    name: "add_member_to_platform",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Invite a new member to the Discord server by creating a one-time-use invite link. Bot tokens cannot add users directly (that requires OAuth2 with guilds.join scope), so this returns an invite URL that the new member opens to join. Defaults to a single-use invite that expires in 24h.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.add_member_to_platform,
    execute: async (input) => {
      const outcome = await discordCommand("add_member_to_platform", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  remove_member_from_platform: defineTool({
    name: "remove_member_from_platform",
    domain: "discord",
    access: { risk: "destructive", minRole: "admin" },
    description:
      "Remove (kick) a member from the Discord server. The user can rejoin with a new invite. Resolve the member ID first via search_members — never kick on ambiguous input. To permanently block them, ban them via ban_member instead.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.remove_member_from_platform,
    execute: async (input) => {
      const outcome = await discordCommand("remove_member_from_platform", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  send_message: defineTool({
    name: "send_message",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Send a message to a channel. Supports Discord markdown formatting. Returns the sent message's ID, channel ID, and content.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.send_message,
    execute: async (input) => {
      const outcome = await discordCommand("send_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_message: defineTool({
    name: "delete_message",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a message from a channel. Requires the message ID and channel ID. This is irreversible.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_message,
    execute: async (input) => {
      const outcome = await discordCommand("delete_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  pin_message: defineTool({
    name: "pin_message",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Pin a message in a channel. Pinned messages appear in the channel's pinned messages panel for easy reference.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.pin_message,
    execute: async (input) => {
      const outcome = await discordCommand("pin_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  unpin_message: defineTool({
    name: "unpin_message",
    domain: "discord",
    access: { risk: "write", confirm: "self" },
    description:
      "Unpin a message in a channel. Removes the message from the channel's pinned messages panel.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.unpin_message,
    execute: async (input) => {
      const outcome = await discordCommand("unpin_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  add_reaction: defineTool({
    name: "add_reaction",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Add a reaction emoji to a message. Use Unicode emoji characters (e.g. '\u{1F44D}') or custom emoji in the format 'name:id' (e.g. 'custom_emoji:123456789').",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.add_reaction,
    execute: async (input) => {
      const outcome = await discordCommand("add_reaction", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  get_message: defineTool({
    name: "get_message",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Get a single message by channel ID and message ID. Returns the message content, author, timestamps, attachments, embeds, and pin status.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.get_message,
    execute: async (input) => {
      const outcome = await discordCommand("get_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_message: defineTool({
    name: "edit_message",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Edit a message the bot sent. Only the bot's own messages can be edited. Replaces the content entirely.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_message,
    execute: async (input) => {
      const outcome = await discordCommand("edit_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  bulk_delete_messages: defineTool({
    name: "bulk_delete_messages",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Bulk delete 2-100 messages from a channel in a single call. Messages must be less than 14 days old. Irreversible.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.bulk_delete_messages,
    execute: async (input) => {
      const outcome = await discordCommand("bulk_delete_messages", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  crosspost_message: defineTool({
    name: "crosspost_message",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Publish (crosspost) a message in an announcement channel so it's sent to following channels.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.crosspost_message,
    execute: async (input) => {
      const outcome = await discordCommand("crosspost_message", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  remove_reaction: defineTool({
    name: "remove_reaction",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Remove a specific user's reaction from a message. Pass '@me' for the bot's own reaction.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.remove_reaction,
    execute: async (input) => {
      const outcome = await discordCommand("remove_reaction", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  remove_all_reactions: defineTool({
    name: "remove_all_reactions",
    domain: "discord",
    access: { risk: "destructive" },
    description: "Remove every reaction from a message. Irreversible.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.remove_all_reactions,
    execute: async (input) => {
      const outcome = await discordCommand("remove_all_reactions", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  fetch_messages: defineTool({
    name: "fetch_messages",
    domain: "discord",
    access: { risk: "read" },
    description:
      "Fetch recent messages from a channel. Returns messages sorted oldest-first with author info, content, timestamps, attachments, and pin status. Supports pagination via before/after message IDs.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.fetch_messages,
    execute: async (input) => {
      const outcome = await discordCommand("fetch_messages", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_role: defineTool({
    name: "create_role",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Create a new role in the server. You can set the name, color, whether it is hoisted (displayed separately in the sidebar), mentionable, and an icon or unicode emoji.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_role,
    execute: async (input) => {
      const outcome = await discordCommand("create_role", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_role: defineTool({
    name: "edit_role",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Edit an existing role's settings including name, color, hoist, mentionable, icon, and unicode emoji.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_role,
    execute: async (input) => {
      const outcome = await discordCommand("edit_role", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_role: defineTool({
    name: "delete_role",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a role from the server. This is irreversible and will remove the role from all members who have it.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_role,
    execute: async (input) => {
      const outcome = await discordCommand("delete_role", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  assign_role: defineTool({
    name: "assign_role",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Assign a role to a server member. Requires both the member's user ID and the role ID.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.assign_role,
    execute: async (input) => {
      const outcome = await discordCommand("assign_role", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  remove_role: defineTool({
    name: "remove_role",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Remove a role from a server member. Requires both the member's user ID and the role ID.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.remove_role,
    execute: async (input) => {
      const outcome = await discordCommand("remove_role", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_stickers: defineTool({
    name: "list_stickers",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List all custom stickers in the Discord server. Returns each sticker's ID, name, description, tags, and URL.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_stickers,
    execute: async (input) => {
      const outcome = await discordCommand("list_stickers", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_sticker: defineTool({
    name: "create_sticker",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Upload a new custom sticker. Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended. Requires a name (2-30 chars), tag (autocomplete suggestion, 2-200 chars), and image URL.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_sticker,
    execute: async (input) => {
      const outcome = await discordCommand("create_sticker", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_sticker: defineTool({
    name: "edit_sticker",
    domain: "discord",
    access: { risk: "write" },
    description: "Edit a custom sticker's name, description, or tag.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_sticker,
    execute: async (input) => {
      const outcome = await discordCommand("edit_sticker", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_sticker: defineTool({
    name: "delete_sticker",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a custom sticker. Irreversible — all prior uses of the sticker become unresolved references.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_sticker,
    execute: async (input) => {
      const outcome = await discordCommand("delete_sticker", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_threads: defineTool({
    name: "list_threads",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List active threads in the server or archived threads in a specific channel. Use channel_id with include_archived to get archived threads from a particular channel.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_threads,
    execute: async (input) => {
      const outcome = await discordCommand("list_threads", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_thread: defineTool({
    name: "create_thread",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Create a new thread in a channel. Can be a standalone thread or start from an existing message. Supports public and private thread types.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_thread,
    execute: async (input) => {
      const outcome = await discordCommand("create_thread", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_thread: defineTool({
    name: "edit_thread",
    domain: "discord",
    access: { risk: "write" },
    description:
      "Edit a thread's settings including name, archived/locked state, auto-archive duration, slowmode, and invitability.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_thread,
    execute: async (input) => {
      const outcome = await discordCommand("edit_thread", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_thread: defineTool({
    name: "delete_thread",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a thread. This is irreversible and will permanently remove the thread and all its messages.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_thread,
    execute: async (input) => {
      const outcome = await discordCommand("delete_thread", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  list_webhooks: defineTool({
    name: "list_webhooks",
    domain: "discord",
    access: { risk: "read" },
    description:
      "List webhooks in the server or a specific channel. Returns webhook IDs, names, channel IDs, and avatars; webhook tokens and URLs are never exposed.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.list_webhooks,
    execute: async (input) => {
      const outcome = await discordCommand("list_webhooks", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  create_webhook: defineTool({
    name: "create_webhook",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Create a webhook in a channel. Returns its non-secret ID, name, and channel; the webhook token and URL are never exposed.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.create_webhook,
    execute: async (input) => {
      const outcome = await discordCommand("create_webhook", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  edit_webhook: defineTool({
    name: "edit_webhook",
    domain: "discord",
    access: { risk: "destructive" },
    description: "Edit a webhook's name, avatar, or move it to a different channel.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.edit_webhook,
    execute: async (input) => {
      const outcome = await discordCommand("edit_webhook", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
  delete_webhook: defineTool({
    name: "delete_webhook",
    domain: "discord",
    access: { risk: "destructive" },
    description:
      "Delete a webhook. This is irreversible and will break any integrations using this webhook's URL.",
    input: DISCORD_COMMAND_INPUT_SCHEMAS.delete_webhook,
    execute: async (input) => {
      const outcome = await discordCommand("delete_webhook", input);
      if (Result.isError(outcome)) throw outcome.error;
      return outcome.value;
    },
  }),
} as const satisfies Record<string, DiscordToolSpec>;

export type DiscordToolName = keyof typeof DISCORD_TOOLS;
