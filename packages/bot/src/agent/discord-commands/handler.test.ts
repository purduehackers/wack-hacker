/* oxlint-disable unicorn/no-null -- Discord JSON projections use null for explicit absence. */
import { expect, test } from "bun:test";

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import type { DiscordCommand } from "@repo/shared/discord-command-wire";
import { RateLimited, UpstreamError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { ChannelType } from "discord.js";

import { executeDiscordCommand } from "./handler.ts";

type DiscordRest = Parameters<typeof executeDiscordCommand>[0];

function restWith(overrides: Partial<DiscordRest>): DiscordRest {
  const unsupported = async (): Promise<never> => {
    throw new Error("unexpected Discord REST call");
  };
  return {
    delete: unsupported,
    get: unsupported,
    patch: unsupported,
    post: unsupported,
    put: unsupported,
    ...overrides,
  };
}

async function succeed(rest: DiscordRest, command: DiscordCommand): Promise<unknown> {
  const result = await executeDiscordCommand(rest, command);
  if (Result.isError(result)) throw result.error;
  return result.value;
}

test("Discord command boundary: projects the managed guild channel tree into the stable semantic response", async () => {
  const categoryId = "20000000000000001";
  const textId = "20000000000000002";
  const voiceId = "20000000000000003";
  const rest = restWith({
    get: async (route) => {
      expect(route).toBe(`/guilds/${DISCORD_GUILD_ID}/channels`);
      return [
        {
          id: textId,
          name: "general",
          type: ChannelType.GuildText,
          topic: "Welcome",
          parent_id: categoryId,
          position: 2,
        },
        {
          id: voiceId,
          name: "Lobby",
          type: ChannelType.GuildVoice,
          position: 3,
        },
        {
          id: categoryId,
          name: "Community",
          type: ChannelType.GuildCategory,
          position: 1,
        },
        {
          id: "20000000000000004",
          name: "thread",
          type: ChannelType.PublicThread,
          parent_id: textId,
          position: 4,
        },
      ];
    },
  });

  expect(
    await succeed(rest, {
      operation: "list_channels",
      input: {},
    }),
  ).toEqual([
    {
      category: { id: categoryId, name: "Community", position: 1 },
      channels: [
        {
          id: textId,
          name: "general",
          type: "text",
          topic: "Welcome",
          parentId: categoryId,
          position: 2,
        },
      ],
    },
    {
      category: null,
      channels: [
        {
          id: voiceId,
          name: "Lobby",
          type: "voice",
          position: 3,
        },
      ],
    },
  ]);
});

test("Discord command boundary: confines channel writes to the managed guild and preserves the semantic request", async () => {
  const channelId = "20000000000000005";
  const calls: { route: unknown; options: unknown }[] = [];
  const rest = restWith({
    get: async (route) => {
      expect(route).toBe(`/channels/${channelId}`);
      return { id: channelId, guild_id: DISCORD_GUILD_ID };
    },
    post: async (route, options) => {
      calls.push({ route, options });
      return { id: "40000000000000001", channel_id: channelId, content: "hello" };
    },
  });

  expect(
    await succeed(rest, {
      operation: "send_message",
      input: { channel_id: channelId, content: "hello" },
    }),
  ).toEqual({ id: "40000000000000001", channelId, content: "hello" });
  expect(calls).toEqual([
    {
      route: `/channels/${channelId}/messages`,
      options: { body: { content: "hello" } },
    },
  ]);

  const outside = await executeDiscordCommand(
    restWith({
      get: async () => ({ id: channelId, guild_id: "90000000000000000" }),
    }),
    {
      operation: "send_message",
      input: { channel_id: channelId, content: "blocked" },
    },
  );
  expect(Result.isError(outside)).toBe(true);
  if (!Result.isError(outside)) return;
  expect(outside.error).toBeInstanceOf(UpstreamError);
  expect(outside.error.message).toContain("outside the managed guild");
});

test("Discord command boundary: never projects webhook credentials across the bot-agent boundary", async () => {
  const rest = restWith({
    get: async () => [
      {
        id: "50000000000000001",
        name: "deploys",
        channel_id: "20000000000000006",
        avatar: "avatar-hash",
        token: "must-not-cross",
        url: "https://discord.com/api/webhooks/secret",
      },
    ],
  });

  const output = await succeed(rest, {
    operation: "list_webhooks",
    input: {},
  });
  expect(output).toEqual([
    {
      id: "50000000000000001",
      name: "deploys",
      channelId: "20000000000000006",
      avatar: "https://cdn.discordapp.com/avatars/50000000000000001/avatar-hash.png",
      createdAt: "50000000000000001",
    },
  ]);
  expect(JSON.stringify(output)).not.toContain("must-not-cross");
  expect(JSON.stringify(output)).not.toContain("api/webhooks");
});

test("Discord command boundary: maps Discord rate limits into the typed expected-error channel", async () => {
  const result = await executeDiscordCommand(
    restWith({
      get: async () => {
        throw Object.assign(new Error("slow down"), { status: 429 });
      },
    }),
    { operation: "list_roles", input: {} },
  );

  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(RateLimited);
  expect(result.error.message).toContain("discord");
});
