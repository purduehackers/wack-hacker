import { defineDynamic } from "eve/skills";

import {
  resolveIntegrationSkills,
  type IntegrationSkillDefinition,
} from "../../../lib/policy/skill-catalog.ts";

export const DISCORD_BASE_TOOL_NAMES = [
  "get_server_info",
  "list_channels",
  "list_roles",
  "search_members",
] as const;

export const DISCORD_SKILL_DEFINITIONS = [
  {
    name: "audit-log",
    description: "View the Discord server audit log — who performed admin actions.",
    criteria:
      "Use when the user wants to investigate recent moderation/admin actions, see who changed what, or audit server activity.",
    minRole: "organizer",
    tools: ["get_audit_log"],
    instructions:
      "- Returns entries with action_type, executor (user_id or resolved name), target_id, reason, and field changes.\n- Action type is a numeric enum (Discord's AuditLogEvent). Common types: 22=member_ban_add, 23=member_ban_remove, 24=member_update, 10=channel_create, 12=channel_delete, 30=role_create, 32=role_delete.\n- Filter by user_id to see everything a specific user did, or by action_type to focus on a category.\n- Paginate with before/after (entry IDs are snowflakes).\n- Entries older than 45 days are discarded by Discord.",
  },
  {
    name: "auto-moderation",
    description:
      "Manage Discord auto-moderation rules — keyword filters, spam detection, mention flooding.",
    criteria:
      "Use when the user wants to configure Discord's built-in auto-mod — creating keyword filters, spam protection, or mention-flood rules.",
    minRole: "organizer",
    tools: [
      "list_auto_mod_rules",
      "get_auto_mod_rule",
      "create_auto_mod_rule",
      "update_auto_mod_rule",
      "delete_auto_mod_rule",
    ],
    instructions:
      "<triggers>\n- 1=keyword: `trigger_metadata.keyword_filter` is an array of substrings.\n- 3=spam: Discord's spam heuristic (no metadata needed).\n- 4=keyword_preset: `trigger_metadata.presets` array — 1=profanity, 2=sexual_content, 3=slurs.\n- 5=mention_spam: `trigger_metadata.mention_total_limit` (int).\n- 6=member_profile: matches against username/nickname.\n</triggers>\n\n<actions>\n- 1=block_message, 2=send_alert (`metadata.channel_id` required), 3=timeout (`metadata.duration_seconds` max 2419200), 4=block_member.\n</actions>\n\n- event_type: 1 (message_send) for content rules, 2 (member_update) for profile rules.\n- Always confirm before delete_auto_mod_rule — active rules protect the server.",
  },
  {
    name: "channels",
    description: "Create, edit, and delete channels and categories.",
    criteria:
      "Use when the user wants to create, edit, move, rename, or delete a channel or category.",
    minRole: "organizer",
    tools: [
      "create_channel",
      "edit_channel",
      "delete_channel",
      "get_channel",
      "follow_announcement_channel",
    ],
    instructions:
      "<creating>\n- Determine the channel type: text, voice, category, announcement, forum, or stage.\n- If placing under a category, use list_channels to find the category ID first.\n- Channel names are automatically lowercased and spaces become hyphens.\n- Only set optional fields if the user explicitly asked for them.\n- Voice/stage channels support: bitrate, user_limit, rtc_region, video_quality_mode.\n- Text/announcement channels support: topic, nsfw, slowmode, default_auto_archive_duration, default_thread_slowmode.\n</creating>\n\n<editing>\n- Use edit_channel to modify name, topic, category, NSFW flag, slowmode, position, and more.\n- To move a channel to a different category, set parent_id to the new category's ID.\n- To remove from its category, set parent_id to null.\n- Only modify the fields the user asked to change.\n</editing>\n\n<deleting>\n- Always confirm with the user before deleting. Channel deletion is irreversible.\n- Deleting a category does NOT delete its child channels — they become uncategorized.\n</deleting>\n\n<inspecting>\n- get_channel returns settings for one channel by ID.\n</inspecting>\n\n<following>\n- follow_announcement_channel pipes messages from a source announcement channel into a target channel in this server.\n</following>",
  },
  {
    name: "emojis",
    description: "Manage custom emojis and stickers — list, create, edit, and delete.",
    criteria: "Use when the user wants to manage custom emojis or stickers.",
    minRole: "organizer",
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
    instructions:
      "<emojis>\n- create_emoji requires a name and image URL. Formats: PNG, JPG, GIF. Max 256KB.\n- Names must be 2-32 characters, alphanumeric and underscores only.\n- Can restrict usage to specific roles.\n- edit_emoji can change name or role restrictions.\n- Always confirm before deleting.\n</emojis>\n\n<stickers>\n- create_sticker requires name, tag (autocomplete suggestion), and image URL.\n- Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended.\n- edit_sticker can change name, description, or tag.\n- Always confirm before deleting.\n</stickers>",
  },
  {
    name: "events",
    description: "List, create, edit, and delete scheduled events.",
    criteria:
      "Use when the user wants to manage scheduled events — listing upcoming events, creating new ones, editing, or canceling them.",
    minRole: "organizer",
    tools: ["list_events", "create_event", "edit_event", "delete_event"],
    instructions:
      '<creating>\n- Every event needs a name and scheduled_start (ISO 8601).\n- Three types: "voice" (requires channel_id), "stage" (requires channel_id), "external" (requires location and scheduled_end).\n- Parse natural language dates relative to current time. When unsure about timezone, ask.\n</creating>\n\n<editing>\n- Can change name, description, start/end times, location, cover image, status, and channel.\n- Status transitions: "scheduled" -> "active" -> "completed" or "canceled".\n- Cannot change event type after creation.\n</editing>\n\n<deleting>\n- Always confirm before deleting an event.\n</deleting>',
  },
  {
    name: "guild",
    description: "View and update server-level settings (admin only for updates).",
    criteria:
      "Use when the user wants to change the server name, icon, banner, verification level, or other server-level settings; or view the public preview/vanity URL.",
    minRole: "admin",
    tools: ["update_guild", "get_guild_preview", "get_vanity_url"],
    instructions:
      "- update_guild changes server settings. Only send the fields the user asked to change.\n- Icons/banners/splash accept data URIs (data:image/png;base64,...). Pass null to remove.\n- verification_level: 0=none, 1=low (verified email), 2=medium (registered >5min), 3=high (on server >10min), 4=very_high (verified phone).\n- get_guild_preview returns public-facing info (member count, description, features).\n- get_vanity_url returns the custom invite if configured (e.g. discord.gg/purduehackers).",
  },
  {
    name: "invites",
    description: "List, create, and delete server invites.",
    criteria:
      "Use when the user wants to manage server invites — listing active invites, creating new ones, or revoking existing ones.",
    minRole: "admin",
    tools: ["list_invites", "create_invite", "delete_invite"],
    instructions:
      "<listing>\n- list_invites returns all active server invites with codes, channels, creators, usage stats, and expiry.\n- Present invites in a table: code, channel, creator, uses/max, expires.\n</listing>\n\n<creating>\n- create_invite requires a channel ID — ask which channel if not specified.\n- Default: 24h expiry, unlimited uses, non-temporary.\n- Set max_uses for one-time invites. Set max_age to 0 for permanent invites.\n- temporary invites auto-kick members who don't get a role before disconnecting.\n- Always return the full URL (discord.gg/CODE) so it can be shared immediately.\n</creating>\n\n<deleting>\n- delete_invite revokes an invite by code. Use list_invites first to find available codes.\n- Always confirm before revoking — this is irreversible.\n</deleting>",
  },
  {
    name: "member-management",
    description: "Moderate members — ban, kick, timeout, and manage the ban list (admin only).",
    criteria:
      "Use when the user wants to ban, unban, kick, timeout, or clear a timeout on a Discord member, or view the ban list.",
    minRole: "admin",
    tools: [
      "ban_member",
      "unban_member",
      "list_bans",
      "kick_member",
      "timeout_member",
      "clear_timeout",
    ],
    instructions:
      "<banning>\n- ban_member permanently blocks the user from rejoining (until unbanned).\n- Optionally delete recent messages via delete_message_seconds (0-604800 = up to 7 days).\n- unban_member removes the ban. Requires the user ID (from list_bans if you don't have it).\n- list_bans returns banned users with reasons; paginate via before/after.\n</banning>\n\n<kicking>\n- kick_member removes the member from the server. They can rejoin with a new invite.\n- Use ban_member instead when you need to prevent rejoining.\n</kicking>\n\n<timeouts>\n- timeout_member silences a member for up to 28 days. They cannot talk, react, or join voice.\n- Duration is in seconds; pick reasonable durations (e.g. 600 = 10min, 3600 = 1h, 86400 = 1d).\n- clear_timeout immediately restores talk permissions.\n</timeouts>\n\nAlways confirm moderation actions with the user first. Always set a reason for the audit log.",
  },
  {
    name: "members",
    description: "View detailed member info and manage nicknames.",
    criteria:
      "Use when the user wants to see detailed member information or change a member's nickname.",
    minRole: "organizer",
    tools: ["get_member", "set_nickname"],
    instructions:
      "<viewing>\n- get_member returns full details: username, display name, nickname, roles, join date, boost status, and avatar.\n- Use search_members first to resolve a name to a member ID.\n- When presenting member info, use their display name and list roles by name.\n</viewing>\n\n<nicknames>\n- set_nickname changes a member's server-specific display name.\n- Pass null to clear a nickname (reverts to global display name).\n- The bot cannot change the server owner's nickname.\n- Nicknames are limited to 32 characters.\n</nicknames>",
  },
  {
    name: "membership",
    description: "Add or remove members from the Discord server (admin only).",
    criteria:
      "Use when the user wants to add a new member to the Discord server or remove an existing member from the server.",
    minRole: "admin",
    tools: ["add_member_to_platform", "remove_member_from_platform"],
    instructions:
      "<adding>\n- add_member_to_platform creates a single-use invite URL (Discord bot tokens cannot add users directly — that requires user-OAuth2 with guilds.join scope).\n- Default expires in 24h, single-use. Override max_age_seconds / max_uses when the user asks.\n- Always share the full URL (`https://discord.gg/CODE`) so the new member can join immediately.\n- Requires a channel_id — pick a general/landing channel unless the user specifies one.\n</adding>\n\n<removing>\n- remove_member_from_platform kicks a member. They keep their Discord account and can rejoin with a new invite.\n- Resolve member_id via search_members before calling — never kick on ambiguous input.\n- For permanent removal, suggest ban_member instead (which also prevents rejoining).\n- Always confirm with the user before removing.\n</removing>",
  },
  {
    name: "messages",
    description: "Send, delete, pin/unpin messages, add reactions, and fetch message history.",
    criteria:
      "Use when the user wants to send a message, delete a message, pin/unpin messages, react to messages, or read message history.",
    minRole: "organizer",
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
    instructions:
      "<sending>\n- Resolve the channel name to an ID via list_channels before sending.\n- Messages are limited to 2000 characters.\n- Don't embed Discord metadata in message content.\n</sending>\n\n<deleting>\n- Requires both channel_id and message_id.\n- Use fetch_messages to find the message ID if described by content or author.\n- Message deletion is irreversible — confirm if context is ambiguous.\n</deleting>\n\n<pinning>\n- Requires channel_id and message_id. Channels have a max of 50 pinned messages.\n</pinning>\n\n<editing>\n- edit_message only works on messages the bot itself sent. Replaces content entirely.\n</editing>\n\n<bulk-delete>\n- bulk_delete_messages deletes 2-100 messages at once. Messages must be <14 days old.\n- Irreversible — confirm before calling.\n</bulk-delete>\n\n<crossposting>\n- crosspost_message publishes an announcement-channel message to following servers.\n</crossposting>\n\n<reactions>\n- add_reaction takes a Unicode emoji (e.g., \"👍\") or a custom emoji in `name:id` format.\n- remove_reaction removes a single user's reaction (pass '@me' for the bot).\n- remove_all_reactions clears every reaction on a message.\n</reactions>\n\n<fetching>\n- Returns messages sorted chronologically. Use before/after for pagination.\n</fetching>",
  },
  {
    name: "roles",
    description: "Create, edit, delete roles, and assign/remove roles from members.",
    criteria:
      "Use when the user wants to create, edit, or delete a role, or assign/remove a role from a member.",
    minRole: "organizer",
    tools: ["create_role", "edit_role", "delete_role", "assign_role", "remove_role"],
    instructions:
      "<creating>\n- Roles require a name. Color, hoist, mentionable, and position are optional.\n- Color uses hex format: '#FF0000' for red.\n- Hoist (true) displays role members in a separate sidebar section.\n- New roles are created at the bottom of the hierarchy by default.\n</creating>\n\n<editing>\n- Only modify the fields the user asked to change.\n- Changing position affects the hierarchy. Higher = more authority.\n</editing>\n\n<deleting>\n- Always confirm before deleting. Removes the role from all members.\n- Managed roles (created by integrations/bots) cannot be deleted.\n</deleting>\n\n<assigning>\n- Resolve both the member and role before assigning.\n- If the target is the requesting user, use their ID from execution context directly.\n- For other users, use search_members to find the member ID.\n- A member can have multiple roles simultaneously.\n</assigning>",
  },
  {
    name: "threads",
    description: "List, create, edit, and delete threads in channels.",
    criteria:
      "Use when the user wants to manage threads — listing, creating, editing, or deleting threads.",
    minRole: "organizer",
    tools: ["list_threads", "create_thread", "edit_thread", "delete_thread"],
    instructions:
      "<listing>\n- Returns active threads by default. Set include_archived for archived threads.\n- Can scope server-wide or to a specific channel.\n</listing>\n\n<creating>\n- Standalone: provide channel_id and name.\n- From a message: also provide message_id.\n- Types: public (default) or private.\n- Auto-archive options: 60, 1440, 4320, 10080 minutes.\n- Cannot create threads inside other threads.\n</creating>\n\n<editing>\n- Can modify name, archived, locked, auto-archive duration, slowmode, invitable.\n- Archiving hides from active list but doesn't delete. Can be unarchived later.\n</editing>\n\n<deleting>\n- Always confirm. Thread deletion is irreversible and removes all messages.\n</deleting>",
  },
  {
    name: "webhooks",
    description: "List, create, edit, and delete webhooks.",
    criteria:
      "Use when the user wants to manage webhooks — listing, creating, editing, moving, or deleting them.",
    minRole: "organizer",
    tools: ["list_webhooks", "create_webhook", "delete_webhook", "edit_webhook"],
    instructions:
      "<listing>\n- Can filter by channel_id or return all server webhooks.\n- Webhook URLs and tokens are sensitive capabilities and are never returned; tools expose only non-secret metadata.\n</listing>\n\n<creating>\n- Requires a channel_id and name. Avatar is optional.\n- Resolve the channel name to an ID via list_channels first.\n- Only text-based channels support webhooks.\n</creating>\n\n<editing>\n- Can change the name, avatar, or target channel.\n- Only modify the fields the user asked to change.\n</editing>\n\n<deleting>\n- Confirm before deleting — integrations using the webhook URL will break.\n</deleting>",
  },
] as const satisfies readonly IntegrationSkillDefinition[];

export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      resolveIntegrationSkills(ctx.session.auth.current, DISCORD_SKILL_DEFINITIONS),
  },
});
