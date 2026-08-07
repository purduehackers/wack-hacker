import { describe, expect, test } from "bun:test";

import {
  decodeDiscordCommand,
  decodeDiscordCommandOutput,
  DISCORD_COMMAND_INPUT_SCHEMAS,
  DISCORD_COMMAND_OPERATIONS,
  DISCORD_COMMAND_OUTPUT_SCHEMAS,
  type DiscordCommandOperation,
} from "./discord-command-wire.ts";
import { Result } from "./result/index.ts";

describe("Discord command wire", () => {
  test("decodes the closed operation union and applies operation defaults", () => {
    const result = decodeDiscordCommand({
      operation: "fetch_messages",
      input: { channel_id: "20000000000000001" },
    });

    expect(Result.isError(result)).toBe(false);
    if (Result.isError(result)) return;
    expect(result.value).toEqual({
      operation: "fetch_messages",
      input: { channel_id: "20000000000000001", limit: 25 },
    });
  });

  test("rejects unknown operations and authority-bearing extra input", () => {
    expect(
      Result.isError(
        decodeDiscordCommand({
          operation: "execute_raw_request",
          input: {},
        }),
      ),
    ).toBe(true);
    expect(
      Result.isError(
        decodeDiscordCommand({
          operation: "send_message",
          input: {
            channel_id: "20000000000000001",
            content: "hello",
            guild_id: "90000000000000000",
          },
        }),
      ),
    ).toBe(true);
  });
});

const id = "20000000000000001";
const secondId = "20000000000000002";
const channel = { id, name: "general", type: "text", position: 1 };
const member = {
  id,
  username: "member",
  displayName: "Member",
  nickname: null,
  roles: [secondId],
  joinedAt: null,
  isBot: false,
};
const event = {
  id,
  name: "Hack Night",
  description: null,
  scheduledStartAt: "2026-08-07T12:00:00.000Z",
  scheduledEndAt: null,
  status: 1,
  entityType: 3,
  channelId: null,
  location: "Krach",
  userCount: null,
  creatorId: null,
  image: null,
};
const autoModRule = {
  id,
  name: "links",
  eventType: 1,
  triggerType: 1,
  enabled: true,
  triggerMetadata: {},
  actions: [],
  exemptRoles: [],
  exemptChannels: [],
};
const emoji = { id, name: "wave", animated: false, url: null, roles: [], createdAt: id };
const sticker = {
  id,
  name: "sticker",
  description: null,
  tags: "wave",
  formatType: 1,
  available: true,
  url: `https://cdn.discordapp.com/stickers/${id}.png`,
};
const thread = {
  id,
  name: "thread",
  parentId: secondId,
  archived: false,
  locked: false,
  autoArchiveDuration: 60,
  messageCount: 1,
  memberCount: 1,
  createdAt: null,
  type: "public_thread",
};
const webhook = { id, name: "hook", channelId: secondId, avatar: null, createdAt: id };
const message = {
  id,
  author: "Member",
  authorId: secondId,
  isBot: false,
  content: "hello",
  timestamp: "2026-08-07T12:00:00.000Z",
  editedTimestamp: null,
  pinned: false,
  attachments: [],
  embeds: 0,
};
const deleted = { success: true, deleted: id };
const compactInvite = {
  code: "invite",
  url: "https://discord.gg/invite",
  maxAge: 3600,
  maxUses: 1,
  expiresAt: null,
};

const VALID_OUTPUTS = {
  get_audit_log: [],
  list_auto_mod_rules: [autoModRule],
  get_auto_mod_rule: autoModRule,
  create_auto_mod_rule: autoModRule,
  update_auto_mod_rule: autoModRule,
  delete_auto_mod_rule: { deleted: true, rule_id: id },
  get_server_info: {
    id,
    name: "Purdue Hackers",
    memberCount: 100,
    presenceCount: 25,
    ownerId: secondId,
    description: null,
    icon: null,
    banner: null,
    boostLevel: 1,
    boostCount: 2,
    verificationLevel: 1,
    createdAt: id,
  },
  list_channels: [{ category: null, channels: [channel] }],
  list_roles: [
    {
      id,
      name: "Organizer",
      color: "#112233",
      position: 1,
      mentionable: true,
      hoist: true,
      managed: false,
      isEveryone: false,
    },
  ],
  search_members: [member],
  create_channel: channel,
  edit_channel: channel,
  get_channel: channel,
  follow_announcement_channel: { followed: true, source: id, target: secondId, webhook_id: id },
  delete_channel: deleted,
  list_emojis: [emoji],
  create_emoji: emoji,
  edit_emoji: emoji,
  delete_emoji: deleted,
  list_events: [event],
  create_event: event,
  edit_event: event,
  delete_event: deleted,
  update_guild: { id, name: "Purdue Hackers", description: null },
  get_guild_preview: {
    id,
    name: "Purdue Hackers",
    description: null,
    memberCount: 100,
    onlineCount: 25,
    features: [],
  },
  get_vanity_url: { configured: false },
  list_invites: [
    {
      code: "invite",
      channel: { id, name: "general" },
      inviter: { id: secondId, username: "member" },
      uses: 0,
      maxUses: 1,
      maxAge: 3600,
      temporary: false,
      expiresAt: null,
    },
  ],
  create_invite: { ...compactInvite, channelId: id, temporary: false },
  delete_invite: deleted,
  ban_member: { banned: true, member_id: id },
  unban_member: { unbanned: true, user_id: id },
  list_bans: [{ userId: id, username: "member", reason: null }],
  kick_member: { kicked: true, member_id: id },
  timeout_member: { timeout_until: "2026-08-07T12:00:00.000Z", member_id: id },
  clear_timeout: { timeout_cleared: true, member_id: id },
  get_member: { ...member, premiumSince: null, avatar: null },
  set_nickname: { success: true, member: id, nickname: null },
  add_member_to_platform: compactInvite,
  remove_member_from_platform: { removed: true, member_id: id },
  send_message: { id, channelId: secondId, content: "hello" },
  delete_message: { success: true, deleted: id },
  pin_message: { success: true, pinned: id },
  unpin_message: { success: true, unpinned: id },
  add_reaction: { success: true, reacted: "wave" },
  get_message: message,
  edit_message: { id, content: "edited" },
  bulk_delete_messages: { deleted: 1, message_ids: [id] },
  crosspost_message: { id, crossposted: true },
  remove_reaction: { removed: true },
  remove_all_reactions: { cleared: true },
  fetch_messages: [message],
  create_role: { id, name: "Organizer", color: "#112233", position: 1 },
  edit_role: { id, name: "Organizer", color: "#112233", position: 1 },
  delete_role: deleted,
  assign_role: { success: true, member: id, role: secondId },
  remove_role: { success: true, member: id, role: secondId },
  list_stickers: [sticker],
  create_sticker: sticker,
  edit_sticker: sticker,
  delete_sticker: { deleted: true, sticker_id: id },
  list_threads: [thread],
  create_thread: thread,
  edit_thread: thread,
  delete_thread: deleted,
  list_webhooks: [webhook],
  create_webhook: webhook,
  edit_webhook: webhook,
  delete_webhook: deleted,
} as const satisfies Record<DiscordCommandOperation, unknown>;

test("has one strict semantic output schema for every unchanged Discord operation", () => {
  expect(Object.keys(DISCORD_COMMAND_INPUT_SCHEMAS).sort()).toEqual(
    [...DISCORD_COMMAND_OPERATIONS].sort(),
  );
  expect(Object.keys(DISCORD_COMMAND_OUTPUT_SCHEMAS).sort()).toEqual(
    [...DISCORD_COMMAND_OPERATIONS].sort(),
  );
  expect(Object.keys(VALID_OUTPUTS).sort()).toEqual([...DISCORD_COMMAND_OPERATIONS].sort());

  for (const operation of DISCORD_COMMAND_OPERATIONS) {
    expect(
      Result.isError(decodeDiscordCommandOutput(operation, VALID_OUTPUTS[operation])),
      operation,
    ).toBe(false);
  }
});

test("rejects extra semantic output keys and malformed operation output", () => {
  expect(
    Result.isError(
      decodeDiscordCommandOutput("create_webhook", {
        ...webhook,
        token: "must-not-cross",
      }),
    ),
  ).toBe(true);
  expect(Result.isError(decodeDiscordCommandOutput("list_roles", {}))).toBe(true);
  expect(Result.isError(decodeDiscordCommandOutput("get_server_info", {}))).toBe(true);
});
