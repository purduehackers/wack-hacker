# `discord`

Server administration for the Purdue Hackers guild — channels, roles, members,
messages, threads, emojis, stickers, invites, scheduled events, webhooks,
auto-moderation, and the audit log.

This is the agent's own Discord REST client, and it is not how the agent talks.
Conversation ingress and every visible reply belong to `packages/bot`, which
holds the gateway connection and is the single writer for rendered output. This
domain is an ordinary provider integration that happens to point at the same
API, on the same policy spine as GitHub or Linear. The two clients keep
independent rate-limit buckets on the same channel routes; both honour
`retry_after`.

<!-- generated: do not edit below this line -->

## Surface

**68 tools** across **14 skills**, plus 4 always-available.

## Skills

| Skill                                                      | Role      | Tools | Description                                                                               |
| ---------------------------------------------------------- | --------- | ----: | ----------------------------------------------------------------------------------------- |
| [`audit-log`](lib/skill_defs/audit-log.md)                 | organizer |     1 | View the Discord server audit log — who performed admin actions.                          |
| [`auto-moderation`](lib/skill_defs/auto-moderation.md)     | organizer |     5 | Manage Discord auto-moderation rules — keyword filters, spam detection, mention flooding. |
| [`channels`](lib/skill_defs/channels.md)                   | organizer |     5 | Create, edit, and delete channels and categories.                                         |
| [`emojis`](lib/skill_defs/emojis.md)                       | organizer |     8 | Manage custom emojis and stickers — list, create, edit, and delete.                       |
| [`events`](lib/skill_defs/events.md)                       | organizer |     4 | List, create, edit, and delete scheduled events.                                          |
| [`guild`](lib/skill_defs/guild.md)                         | admin     |     3 | View and update server-level settings (admin only for updates).                           |
| [`invites`](lib/skill_defs/invites.md)                     | admin     |     3 | List, create, and delete server invites.                                                  |
| [`member-management`](lib/skill_defs/member-management.md) | admin     |     6 | Moderate members — ban, kick, timeout, and manage the ban list (admin only).              |
| [`members`](lib/skill_defs/members.md)                     | organizer |     2 | View detailed member info and manage nicknames.                                           |
| [`membership`](lib/skill_defs/membership.md)               | admin     |     2 | Add or remove members from the Discord server (admin only).                               |
| [`messages`](lib/skill_defs/messages.md)                   | organizer |    12 | Send, delete, pin/unpin messages, add reactions, and fetch message history.               |
| [`roles`](lib/skill_defs/roles.md)                         | organizer |     5 | Create, edit, delete roles, and assign/remove roles from members.                         |
| [`threads`](lib/skill_defs/threads.md)                     | organizer |     4 | List, create, edit, and delete threads in channels.                                       |
| [`webhooks`](lib/skill_defs/webhooks.md)                   | organizer |     4 | List, create, edit, and delete webhooks.                                                  |

## Always available

Reachable without loading a skill.

| Tool              | Risk | Role   | What it does                                                                                                    |
| ----------------- | ---- | ------ | --------------------------------------------------------------------------------------------------------------- |
| `get_server_info` | read | public | Get Discord server overview: name, member count, channel count, role count, and basic settings.                 |
| `list_channels`   | read | public | List all channels in the Discord server, organized by category.                                                 |
| `list_roles`      | read | public | List all roles in the Discord server with their colors, positions, and whether they are hoisted or mentionable. |
| `search_members`  | read | public | Search for server members by name, nickname, or user ID.                                                        |

## `audit-log`

View the Discord server audit log — who performed admin actions.

| Tool            | Risk | Role   | What it does                        |
| --------------- | ---- | ------ | ----------------------------------- |
| `get_audit_log` | read | public | Get the Discord server's audit log. |

## `auto-moderation`

Manage Discord auto-moderation rules — keyword filters, spam detection, mention flooding.

| Tool                   | Risk        | Role      | What it does                                                                |
| ---------------------- | ----------- | --------- | --------------------------------------------------------------------------- |
| `create_auto_mod_rule` | destructive | organizer | Create an auto-moderation rule.                                             |
| `delete_auto_mod_rule` | destructive | organizer | Delete an auto-moderation rule.                                             |
| `get_auto_mod_rule`    | read        | public    | Get full details for a single auto-moderation rule by ID.                   |
| `list_auto_mod_rules`  | read        | public    | List all auto-moderation rules in the Discord server.                       |
| `update_auto_mod_rule` | destructive | organizer | Update an auto-moderation rule's name, trigger, actions, or enabled status. |

## `channels`

Create, edit, and delete channels and categories.

| Tool                          | Risk        | Role      | What it does                                                                                                           |
| ----------------------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `create_channel`              | write       | organizer | Create a new channel in the Discord server.                                                                            |
| `delete_channel`              | destructive | organizer | Delete a channel from the server.                                                                                      |
| `edit_channel`                | write       | organizer | Edit an existing channel's settings such as name, topic, slowmode, position, NSFW flag, parent category, and voice-sp… |
| `follow_announcement_channel` | destructive | organizer | Follow an announcement channel — its messages will be auto-crossposted to the target channel in this server.           |
| `get_channel`                 | read        | public    | Get a single channel's details by ID.                                                                                  |

## `emojis`

Manage custom emojis and stickers — list, create, edit, and delete.

| Tool             | Risk        | Role      | What it does                                       |
| ---------------- | ----------- | --------- | -------------------------------------------------- |
| `create_emoji`   | write       | organizer | Create a custom emoji from an image URL.           |
| `create_sticker` | write       | organizer | Upload a new custom sticker.                       |
| `delete_emoji`   | destructive | organizer | Delete a custom emoji.                             |
| `delete_sticker` | destructive | organizer | Delete a custom sticker.                           |
| `edit_emoji`     | write       | organizer | Edit a custom emoji's name or role restrictions.   |
| `edit_sticker`   | write       | organizer | Edit a custom sticker's name, description, or tag. |
| `list_emojis`    | read        | public    | List all custom emojis in the server.              |
| `list_stickers`  | read        | public    | List all custom stickers in the Discord server.    |

## `events`

List, create, edit, and delete scheduled events.

| Tool           | Risk        | Role      | What it does                                                                            |
| -------------- | ----------- | --------- | --------------------------------------------------------------------------------------- |
| `create_event` | write       | organizer | Create a scheduled event in the server.                                                 |
| `delete_event` | destructive | organizer | Delete a scheduled event.                                                               |
| `edit_event`   | write       | organizer | Edit a scheduled event's name, description, times, location, image, status, or channel. |
| `list_events`  | read        | public    | List all scheduled events in the server.                                                |

## `guild`

View and update server-level settings (admin only for updates).

| Tool                | Risk        | Role   | What it does                                                                                                           |
| ------------------- | ----------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| `get_guild_preview` | read        | public | Get public preview info for the Discord server — approximate member count, online count, description, features, and s… |
| `get_vanity_url`    | read        | public | Get the Discord server's vanity invite URL (e.g.                                                                       |
| `update_guild`      | destructive | admin  | Update core Discord server settings — name, description, icon, banner, afk channel, verification level, etc.           |

## `invites`

List, create, and delete server invites.

| Tool            | Risk        | Role  | What it does                                                                                         |
| --------------- | ----------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `create_invite` | destructive | admin | Create a new server invite for a specific channel.                                                   |
| `delete_invite` | destructive | admin | Revoke an active invite by its code.                                                                 |
| `list_invites`  | read        | admin | List all active server invites with their codes, channels, creators, usage counts, and expiry dates. |

## `member-management`

Moderate members — ban, kick, timeout, and manage the ban list (admin only).

| Tool             | Risk        | Role  | What it does                                                                      |
| ---------------- | ----------- | ----- | --------------------------------------------------------------------------------- |
| `ban_member`     | destructive | admin | Ban a member from the Discord server.                                             |
| `clear_timeout`  | destructive | admin | Clear an active timeout on a member, restoring their ability to talk immediately. |
| `kick_member`    | destructive | admin | Kick a member from the Discord server.                                            |
| `list_bans`      | read        | admin | List banned users in the Discord server.                                          |
| `timeout_member` | destructive | admin | Timeout a member.                                                                 |
| `unban_member`   | destructive | admin | Remove a ban for a Discord user, allowing them to rejoin the server.              |

## `members`

View detailed member info and manage nicknames.

| Tool           | Risk  | Role      | What it does                                                                                                         |
| -------------- | ----- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `get_member`   | read  | public    | Get detailed information about a server member including their roles, join date, nickname, avatar, and boost status. |
| `set_nickname` | write | organizer | Set or clear a member's server nickname.                                                                             |

## `membership`

Add or remove members from the Discord server (admin only).

| Tool                          | Risk        | Role  | What it does                                                                      |
| ----------------------------- | ----------- | ----- | --------------------------------------------------------------------------------- |
| `add_member_to_platform`      | destructive | admin | Invite a new member to the Discord server by creating a one-time-use invite link. |
| `remove_member_from_platform` | destructive | admin | Remove (kick) a member from the Discord server.                                   |

## `messages`

Send, delete, pin/unpin messages, add reactions, and fetch message history.

| Tool                   | Risk        | Role      | What it does                                                                                 |
| ---------------------- | ----------- | --------- | -------------------------------------------------------------------------------------------- |
| `add_reaction`         | write       | organizer | Add a reaction emoji to a message.                                                           |
| `bulk_delete_messages` | destructive | organizer | Bulk delete 2-100 messages from a channel in a single call.                                  |
| `crosspost_message`    | destructive | organizer | Publish (crosspost) a message in an announcement channel so it's sent to following channels. |
| `delete_message`       | destructive | organizer | Delete a message from a channel.                                                             |
| `edit_message`         | destructive | organizer | Edit a message the bot sent.                                                                 |
| `fetch_messages`       | read        | public    | Fetch recent messages from a channel.                                                        |
| `get_message`          | read        | public    | Get a single message by channel ID and message ID.                                           |
| `pin_message`          | write       | organizer | Pin a message in a channel.                                                                  |
| `remove_all_reactions` | destructive | organizer | Remove every reaction from a message.                                                        |
| `remove_reaction`      | destructive | organizer | Remove a specific user's reaction from a message.                                            |
| `send_message`         | destructive | organizer | Send a message to a channel.                                                                 |
| `unpin_message`        | write       | organizer | Unpin a message in a channel.                                                                |

## `roles`

Create, edit, delete roles, and assign/remove roles from members.

| Tool          | Risk        | Role      | What it does                                                                                         |
| ------------- | ----------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `assign_role` | destructive | organizer | Assign a role to a server member.                                                                    |
| `create_role` | write       | organizer | Create a new role in the server.                                                                     |
| `delete_role` | destructive | organizer | Delete a role from the server.                                                                       |
| `edit_role`   | destructive | organizer | Edit an existing role's settings including name, color, hoist, mentionable, icon, and unicode emoji. |
| `remove_role` | destructive | organizer | Remove a role from a server member.                                                                  |

## `threads`

List, create, edit, and delete threads in channels.

| Tool            | Risk        | Role      | What it does                                                                                                       |
| --------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `create_thread` | write       | organizer | Create a new thread in a channel.                                                                                  |
| `delete_thread` | destructive | organizer | Delete a thread.                                                                                                   |
| `edit_thread`   | write       | organizer | Edit a thread's settings including name, archived/locked state, auto-archive duration, slowmode, and invitability. |
| `list_threads`  | read        | public    | List active threads in the server or archived threads in a specific channel.                                       |

## `webhooks`

List, create, edit, and delete webhooks.

| Tool             | Risk        | Role      | What it does                                                      |
| ---------------- | ----------- | --------- | ----------------------------------------------------------------- |
| `create_webhook` | destructive | organizer | Create a webhook in a channel.                                    |
| `delete_webhook` | destructive | organizer | Delete a webhook.                                                 |
| `edit_webhook`   | destructive | organizer | Edit a webhook's name, avatar, or move it to a different channel. |
| `list_webhooks`  | read        | public    | List webhooks in the server or a specific channel.                |
