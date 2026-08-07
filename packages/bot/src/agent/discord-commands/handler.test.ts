/* oxlint-disable unicorn/no-null -- Discord JSON projections use null for explicit absence. */
import { expect, test } from "bun:test";

import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { decodeDiscordCommand, type DiscordCommand } from "@repo/shared/discord-command-wire";
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

function archivedThreadFixture(
  parentId: string,
  id: string,
  name: string,
  type: ChannelType,
  archiveTimestamp: string,
) {
  return {
    id,
    name,
    type,
    parent_id: parentId,
    thread_metadata: {
      archived: true,
      auto_archive_duration: 1_440,
      archive_timestamp: archiveTimestamp,
      locked: false,
      create_timestamp: archiveTimestamp,
    },
    message_count: 1,
    member_count: 1,
  };
}

function archivedPaginationFixtures(parentId: string) {
  return {
    active: archivedThreadFixture(
      parentId,
      "60000000000000090",
      "active",
      ChannelType.PublicThread,
      "2026-08-07T12:00:00.000Z",
    ),
    publicSecond: archivedThreadFixture(
      parentId,
      "60000000000000080",
      "public-second",
      ChannelType.PublicThread,
      "2026-08-07T11:00:00.000Z",
    ),
    privateFirst: archivedThreadFixture(
      parentId,
      "60000000000000070",
      "private-first",
      ChannelType.PrivateThread,
      "2026-08-07T10:00:00.000Z",
    ),
    privateSecond: archivedThreadFixture(
      parentId,
      "60000000000000060",
      "private-second",
      ChannelType.PrivateThread,
      "2026-08-07T09:00:00.000Z",
    ),
    joinedFirst: archivedThreadFixture(
      parentId,
      "60000000000000050",
      "joined-first",
      ChannelType.PrivateThread,
      "2026-08-07T08:00:00.000Z",
    ),
    joinedSecond: archivedThreadFixture(
      parentId,
      "60000000000000040",
      "joined-second",
      ChannelType.PrivateThread,
      "2026-08-07T07:00:00.000Z",
    ),
  };
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

test("Discord command boundary: rejects malformed Discord lists instead of returning empty success", async () => {
  const result = await executeDiscordCommand(restWith({ get: async () => ({}) }), {
    operation: "list_roles",
    input: {},
  });
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord command boundary: rejects partial semantic summaries from malformed objects", async () => {
  const result = await executeDiscordCommand(restWith({ get: async () => ({}) }), {
    operation: "get_server_info",
    input: {},
  });
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
  expect(result.error.message).toContain("invalid Discord get_server_info output");
});

test("Discord command boundary: preserves the legacy pin route and encoded reaction routes", async () => {
  const channelId = "20000000000000007";
  const messageId = "40000000000000002";
  const recordedRoutes: unknown[] = [];
  const rest = restWith({
    get: async () => ({ id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 }),
    put: async (route) => {
      recordedRoutes.push(route);
    },
    delete: async (route) => {
      recordedRoutes.push(route);
    },
  });

  await succeed(rest, {
    operation: "pin_message",
    input: { channel_id: channelId, message_id: messageId },
  });
  await succeed(rest, {
    operation: "add_reaction",
    input: { channel_id: channelId, message_id: messageId, emoji: "party parrot" },
  });
  await succeed(rest, {
    operation: "remove_reaction",
    input: { channel_id: channelId, message_id: messageId, emoji: "party parrot", user_id: "@me" },
  });

  expect(recordedRoutes).toEqual([
    `/channels/${channelId}/pins/${messageId}`,
    `/channels/${channelId}/messages/${messageId}/reactions/party%20parrot/@me`,
    `/channels/${channelId}/messages/${messageId}/reactions/party%20parrot/@me`,
  ]);
});

test("Discord command boundary: classifies malformed nested Discord objects as upstream failures", async () => {
  const channelId = "20000000000000008";
  const messageId = "40000000000000003";
  const result = await executeDiscordCommand(
    restWith({
      get: async (route) =>
        route === `/channels/${channelId}`
          ? { id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 }
          : {
              id: messageId,
              author: null,
              content: "hello",
              timestamp: "2026-08-07T12:00:00.000Z",
              edited_timestamp: null,
              pinned: false,
              attachments: [],
              embeds: [],
            },
    }),
    { operation: "get_message", input: { channel_id: channelId, message_id: messageId } },
  );
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord sticker creation preserves current formats, adds GIF, and sends the real REST body", async () => {
  const originalFetch = globalThis.fetch;
  const contentTypes = {
    png: "image/png",
    apng: "image/apng",
    gif: "image/gif",
    json: "application/json",
  } as const;
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const extension = url.pathname.slice(url.pathname.lastIndexOf(".") + 1);
    const contentType = Object.entries(contentTypes).find(([key]) => key === extension)?.[1];
    if (contentType === undefined) return new Response("unsupported", { status: 404 });
    return new Response(new Uint8Array([1]), {
      headers: { "content-type": contentType, "content-length": "1" },
    });
  };
  fetch.preconnect = originalFetch.preconnect;
  globalThis.fetch = fetch;

  const capturedRequests: NonNullable<Parameters<DiscordRest["post"]>[1]>[] = [];
  const rest = restWith({
    post: async (_route, options) => {
      if (options === undefined) throw new Error("expected sticker request options");
      capturedRequests.push(options);
      return {
        id: "50000000000000002",
        name: "wave",
        description: "",
        tags: "wave",
        format_type: 1,
        available: true,
      };
    },
  });

  try {
    for (const extension of Object.keys(contentTypes)) {
      const decoded = decodeDiscordCommand({
        operation: "create_sticker",
        input: {
          name: "wave",
          tags: "wave",
          url: `https://cdn.example.test/sticker.${extension}`,
        },
      });
      if (Result.isError(decoded)) throw decoded.error;
      await succeed(rest, decoded.value);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  expect(capturedRequests.map((entry) => entry.body)).toEqual([
    { name: "wave", description: "", tags: "wave" },
    { name: "wave", description: "", tags: "wave" },
    { name: "wave", description: "", tags: "wave" },
    { name: "wave", description: "", tags: "wave" },
  ]);
  expect(capturedRequests.map((entry) => entry.files?.[0]?.name)).toEqual([
    "sticker.png",
    "sticker.png",
    "sticker.gif",
    "sticker.json",
  ]);
  expect(capturedRequests.map((entry) => entry.files?.[0]?.contentType)).toEqual([
    "image/png",
    "image/apng",
    "image/gif",
    "application/json",
  ]);
});

test("Discord sticker creation retains the 512 KiB media limit", async () => {
  const originalFetch = globalThis.fetch;
  const fetch = async (): Promise<Response> =>
    new Response(new Uint8Array(), {
      headers: { "content-type": "image/gif", "content-length": String(512 * 1_024 + 1) },
    });
  fetch.preconnect = originalFetch.preconnect;
  globalThis.fetch = fetch;
  let posts = 0;
  try {
    const result = await executeDiscordCommand(
      restWith({
        post: async () => {
          posts += 1;
          return {};
        },
      }),
      {
        operation: "create_sticker",
        input: {
          name: "wave",
          description: "",
          tags: "wave",
          url: "https://cdn.example.test/sticker.gif",
        },
      },
    );
    expect(Result.isError(result)).toBe(true);
    if (!Result.isError(result)) return;
    expect(result.error).toBeInstanceOf(UpstreamError);
    if (!(result.error instanceof UpstreamError)) return;
    expect(result.error.status).toBe(413);
    expect(posts).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Discord command boundary: rejects malformed nested message embeds as UpstreamError 502", async () => {
  const channelId = "20000000000000009";
  const messageId = "40000000000000004";
  const result = await executeDiscordCommand(
    restWith({
      get: async (route) =>
        route === `/channels/${channelId}`
          ? { id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 }
          : {
              id: messageId,
              author: {
                id: "10000000000000001",
                username: "member",
                global_name: "Member",
              },
              content: "hello",
              timestamp: "2026-08-07T12:00:00.000Z",
              edited_timestamp: null,
              pinned: false,
              attachments: [],
              embeds: null,
            },
    }),
    { operation: "get_message", input: { channel_id: channelId, message_id: messageId } },
  );
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord role position commands summarize the Modify Guild Role Positions result", async () => {
  const roleId = "50000000000000003";
  const staleRole = {
    id: roleId,
    name: "moderator",
    color: 0,
    position: 1,
    mentionable: false,
    hoist: false,
    managed: false,
  };
  const positionedRole = { ...staleRole, position: 7 };

  const created = await succeed(
    restWith({
      post: async () => staleRole,
      patch: async () => [positionedRole],
    }),
    {
      operation: "create_role",
      input: { name: "moderator", hoist: false, mentionable: false, position: 7 },
    },
  );
  expect(created).toMatchObject({ position: 7 });

  let patches = 0;
  const edited = await succeed(
    restWith({
      patch: async () => {
        patches += 1;
        return patches === 1 ? staleRole : [positionedRole];
      },
    }),
    { operation: "edit_role", input: { role_id: roleId, position: 7 } },
  );
  expect(edited).toMatchObject({ position: 7 });
});

test("Discord role position commands reject a result without the positioned role", async () => {
  const roleId = "50000000000000003";
  const result = await executeDiscordCommand(
    restWith({
      post: async () => ({
        id: roleId,
        name: "moderator",
        color: 0,
        position: 1,
        mentionable: false,
        hoist: false,
        managed: false,
      }),
      patch: async () => [],
    }),
    {
      operation: "create_role",
      input: { name: "moderator", hoist: false, mentionable: false, position: 7 },
    },
  );
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord archived thread listing fetches every applicable route and deduplicates by id", async () => {
  const channelId = "20000000000000010";
  const archiveTimestamp = "2026-08-07T12:00:00.000Z";
  const makeThread = (id: string, name: string, type: ChannelType) => ({
    id,
    name,
    type,
    parent_id: channelId,
    thread_metadata: {
      archived: true,
      auto_archive_duration: 1_440,
      archive_timestamp: archiveTimestamp,
      locked: false,
      create_timestamp: archiveTimestamp,
    },
    message_count: 1,
    member_count: 1,
  });
  const active = makeThread("60000000000000001", "active", ChannelType.PublicThread);
  const publicThread = makeThread("60000000000000002", "public", ChannelType.PublicThread);
  const privateThread = makeThread("60000000000000003", "private", ChannelType.PrivateThread);
  const joinedThread = makeThread("60000000000000004", "joined", ChannelType.PrivateThread);
  const visitedRoutes: string[] = [];

  const listedThreads = await succeed(
    restWith({
      get: async (endpointRoute) => {
        visitedRoutes.push(endpointRoute);
        if (endpointRoute === `/guilds/${DISCORD_GUILD_ID}/threads/active`) {
          return { threads: [active], members: [] };
        }
        if (endpointRoute === `/channels/${channelId}`) {
          return { id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 };
        }
        if (endpointRoute === `/channels/${channelId}/threads/archived/public`) {
          return { threads: [active, publicThread], members: [], has_more: false };
        }
        if (endpointRoute === `/channels/${channelId}/threads/archived/private`) {
          return { threads: [privateThread], members: [], has_more: false };
        }
        if (endpointRoute === `/channels/${channelId}/users/@me/threads/archived/private`) {
          return { threads: [privateThread, joinedThread], members: [], has_more: false };
        }
        throw new Error(`unexpected route ${endpointRoute}`);
      },
    }),
    {
      operation: "list_threads",
      input: { channel_id: channelId, include_archived: true },
    },
  );

  expect(visitedRoutes).toEqual([
    `/guilds/${DISCORD_GUILD_ID}/threads/active`,
    `/channels/${channelId}`,
    `/channels/${channelId}/threads/archived/public`,
    `/channels/${channelId}/threads/archived/private`,
    `/channels/${channelId}/users/@me/threads/archived/private`,
  ]);
  expect(listedThreads).toEqual([
    expect.objectContaining({ id: active.id }),
    expect.objectContaining({ id: publicThread.id }),
    expect.objectContaining({ id: privateThread.id }),
    expect.objectContaining({ id: joinedThread.id }),
  ]);
});

test("Discord sticker editing preserves omitted versus explicit null descriptions", async () => {
  const stickerId = "50000000000000004";
  const bodies: unknown[] = [];
  const rest = restWith({
    patch: async (_route, options) => {
      bodies.push(options?.body);
      return {
        id: stickerId,
        name: "wave",
        description: null,
        tags: "wave",
        format_type: 1,
        available: true,
      };
    },
  });
  await succeed(rest, {
    operation: "edit_sticker",
    input: { sticker_id: stickerId },
  });
  await succeed(rest, {
    operation: "edit_sticker",
    input: { sticker_id: stickerId, description: null },
  });
  expect(bodies).toEqual([{}, { description: null }]);
});

test("Discord archived thread listing follows every route's native pagination cursor", async () => {
  const channelId = "20000000000000011";
  const { active, publicSecond, privateFirst, privateSecond, joinedFirst, joinedSecond } =
    archivedPaginationFixtures(channelId);
  const calls: string[] = [];
  const pageCounts = new Map<string, number>();

  const listedThreads = await succeed(
    restWith({
      get: async (route, options) => {
        const query = options?.query?.toString() ?? "";
        calls.push(query.length === 0 ? route : `${route}?${query}`);
        if (route === `/guilds/${DISCORD_GUILD_ID}/threads/active`) {
          return { threads: [active], members: [] };
        }
        if (route === `/channels/${channelId}`) {
          return { id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 };
        }
        const page = pageCounts.get(route) ?? 0;
        pageCounts.set(route, page + 1);
        if (route === `/channels/${channelId}/threads/archived/public`) {
          return page === 0
            ? { threads: [active], members: [], has_more: true }
            : { threads: [publicSecond], members: [], has_more: false };
        }
        if (route === `/channels/${channelId}/threads/archived/private`) {
          return page === 0
            ? { threads: [privateFirst], members: [], has_more: true }
            : { threads: [privateSecond], members: [], has_more: false };
        }
        if (route === `/channels/${channelId}/users/@me/threads/archived/private`) {
          return page === 0
            ? { threads: [joinedFirst], members: [], has_more: true }
            : { threads: [joinedSecond], members: [], has_more: false };
        }
        throw new Error(`unexpected route ${route}`);
      },
    }),
    {
      operation: "list_threads",
      input: { channel_id: channelId, include_archived: true },
    },
  );

  expect(calls).toEqual([
    `/guilds/${DISCORD_GUILD_ID}/threads/active`,
    `/channels/${channelId}`,
    `/channels/${channelId}/threads/archived/public?limit=100`,
    `/channels/${channelId}/threads/archived/public?limit=100&before=2026-08-07T12%3A00%3A00.000Z`,
    `/channels/${channelId}/threads/archived/private?limit=100`,
    `/channels/${channelId}/threads/archived/private?limit=100&before=2026-08-07T10%3A00%3A00.000Z`,
    `/channels/${channelId}/users/@me/threads/archived/private?limit=100`,
    `/channels/${channelId}/users/@me/threads/archived/private?limit=100&before=60000000000000050`,
  ]);
  expect(listedThreads).toEqual([
    expect.objectContaining({ id: active.id }),
    expect.objectContaining({ id: publicSecond.id }),
    expect.objectContaining({ id: privateFirst.id }),
    expect.objectContaining({ id: privateSecond.id }),
    expect.objectContaining({ id: joinedFirst.id }),
    expect.objectContaining({ id: joinedSecond.id }),
  ]);
});

test("Discord archived thread pagination rejects missing and nonadvancing cursors as 502", async () => {
  const channelId = "20000000000000012";
  const timestamp = "2026-08-07T12:00:00.000Z";
  const thread = {
    id: "60000000000000030",
    name: "archived",
    type: ChannelType.PublicThread,
    parent_id: channelId,
    thread_metadata: {
      archived: true,
      auto_archive_duration: 1_440,
      archive_timestamp: timestamp,
      locked: false,
      create_timestamp: timestamp,
    },
    message_count: 1,
    member_count: 1,
  };

  for (const failure of ["missing", "nonadvancing"] as const) {
    let publicPages = 0;
    const result = await executeDiscordCommand(
      restWith({
        get: async (route) => {
          if (route === `/guilds/${DISCORD_GUILD_ID}/threads/active`) {
            return { threads: [], members: [] };
          }
          if (route === `/channels/${channelId}`) {
            return { id: channelId, guild_id: DISCORD_GUILD_ID, name: "general", type: 0 };
          }
          if (route === `/channels/${channelId}/threads/archived/public`) {
            publicPages += 1;
            if (failure === "missing") return { threads: [], members: [], has_more: true };
            return { threads: [thread], members: [], has_more: true };
          }
          throw new Error(`unexpected route ${route}`);
        },
      }),
      {
        operation: "list_threads",
        input: { channel_id: channelId, include_archived: true },
      },
    );
    expect(Result.isError(result), failure).toBe(true);
    if (!Result.isError(result)) continue;
    expect(result.error, failure).toBeInstanceOf(UpstreamError);
    if (!(result.error instanceof UpstreamError)) continue;
    expect(result.error.status, failure).toBe(502);
    expect(publicPages, failure).toBe(failure === "missing" ? 1 : 2);
  }
});
