import type { Client } from "discord.js";

import { ChannelType, Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";

import { PacketSchema } from "../packets.ts";
import { bindGatewayEvents, getDedupKey, packetEvents } from "./index.ts";
import { messageCreateEvent } from "./message-create.ts";
import { messageDeleteEvent } from "./message-delete.ts";
import { reactionAddEvent, reactionRemoveEvent } from "./reactions.ts";

/**
 * Drives each event's `bind` with a fake discord.js client and asserts the
 * published packet parses against `PacketSchema` — pinning the agreement
 * between gateway serialization and the wire schema, which used to live in
 * two different files and could drift silently.
 */
function capture<P>(bind: (client: Client, publish: (packet: P) => Promise<void>) => void) {
  const listeners = new Map<string, (...args: unknown[]) => Promise<void>>();
  const client = {
    on: (event: string, handler: (...args: unknown[]) => Promise<void>) => {
      listeners.set(event, handler);
    },
  } as unknown as Client;
  const publish = vi.fn().mockResolvedValue(undefined);
  bind(client, publish);
  return { listeners, publish };
}

function fakeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    author: {
      id: "user-1",
      username: "alice",
      displayName: "Alice",
      bot: false,
      avatar: "hash",
    },
    attachments: [
      {
        id: "a1",
        url: "https://x.com/f.png",
        name: "f.png",
        contentType: "image/png",
        size: 1024,
        width: null,
        height: null,
      },
    ],
    channel: {
      id: "ch-1",
      name: "general",
      type: ChannelType.GuildText,
      isThread: () => false,
      parent: null,
      parentId: "cat-1",
    },
    content: "hello",
    guildId: "guild-1",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    member: { roles: { cache: new Map([["role-1", {}]]) } },
    flags: { bitfield: 0 },
    mentions: { users: new Map([["bot-123", {}]]), repliedUser: { id: "bot-123" } },
    reference: { messageId: "msg-0", channelId: "ch-1" },
    ...overrides,
  };
}

describe("messageCreateEvent.bind", () => {
  it("publishes a packet that parses against PacketSchema", async () => {
    const { listeners, publish } = capture(messageCreateEvent.bind);
    await listeners.get(Events.MessageCreate)!(fakeMessage());

    expect(publish).toHaveBeenCalledOnce();
    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    if (packet.type !== "GATEWAY_MESSAGE_CREATE") throw new Error("wrong type");
    expect(packet.data).toMatchObject({
      id: "msg-1",
      content: "hello",
      guildId: "guild-1",
      channel: { id: "ch-1", name: "general" },
      memberRoles: ["role-1"],
      mentions: ["bot-123"],
      categoryId: "cat-1",
      reference: { messageId: "msg-0", channelId: "ch-1", authorId: "bot-123" },
    });
    expect(getDedupKey(packet)).toBe("msg:msg-1");
  });

  it("ignores bot authors and non-text channels", async () => {
    const { listeners, publish } = capture(messageCreateEvent.bind);
    await listeners.get(Events.MessageCreate)!(
      fakeMessage({ author: { id: "b", username: "bot", bot: true } }),
    );
    await listeners.get(Events.MessageCreate)!(
      fakeMessage({
        channel: { id: "vc", name: "voice", type: ChannelType.GuildVoice, isThread: () => false },
      }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("messageCreateEvent.bind — serialization", () => {
  it("serializes thread messages with the parent reference", async () => {
    const { listeners, publish } = capture(messageCreateEvent.bind);
    await listeners.get(Events.MessageCreate)!(
      fakeMessage({
        channel: {
          id: "th-1",
          name: "a-thread",
          type: ChannelType.PublicThread,
          isThread: () => true,
          parent: { name: "general" },
          parentId: "ch-1",
        },
        reference: null,
      }),
    );
    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    if (packet.type !== "GATEWAY_MESSAGE_CREATE") throw new Error("wrong type");
    expect(packet.data.thread).toEqual({ parentId: "ch-1", parentName: "general" });
    expect(packet.data.categoryId).toBeUndefined();
    expect(packet.data.reference).toBeUndefined();
  });

  it("serializes forwarded snapshots and falls back on sparse fields", async () => {
    const { listeners, publish } = capture(messageCreateEvent.bind);
    await listeners.get(Events.MessageCreate)!(
      fakeMessage({
        member: null,
        flags: undefined,
        attachments: [],
        author: { id: "user-1", username: "alice", displayName: "Alice", bot: false, avatar: null },
        channel: {
          id: "ch-1",
          name: "general",
          type: ChannelType.GuildText,
          isThread: () => false,
          parent: null,
          parentId: null,
        },
        mentions: { users: new Map(), repliedUser: undefined },
        reference: { messageId: "msg-0", channelId: null },
        messageSnapshots: [
          {
            content: "forwarded text",
            attachments: [
              {
                id: "fa1",
                url: "https://x.com/g.png",
                name: "g.png",
                contentType: null,
                size: 5,
                width: null,
                height: null,
              },
            ],
          },
          { content: null, attachments: null },
        ],
      }),
    );
    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    if (packet.type !== "GATEWAY_MESSAGE_CREATE") throw new Error("wrong type");
    expect(packet.data.memberRoles).toEqual([]);
    expect(packet.data.flags).toBeUndefined();
    expect(packet.data.reference).toEqual({
      messageId: "msg-0",
      channelId: undefined,
      authorId: undefined,
    });
    expect(packet.data.forwardedSnapshots).toEqual([
      {
        content: "forwarded text",
        attachments: [
          {
            id: "fa1",
            url: "https://x.com/g.png",
            filename: "g.png",
            contentType: undefined,
            size: 5,
            width: undefined,
            height: undefined,
          },
        ],
      },
      { content: undefined, attachments: undefined },
    ]);
  });
});

describe.each([
  { event: reactionAddEvent, discordEvent: Events.MessageReactionAdd, keyPrefix: "react" },
  { event: reactionRemoveEvent, discordEvent: Events.MessageReactionRemove, keyPrefix: "unreact" },
])("$event.type bind", ({ event, discordEvent, keyPrefix }) => {
  // ids live on the partial — the bind reads them directly without a REST
  // fetch, so the fake deliberately omits a `fetch` method.
  const reaction = {
    emoji: { id: null, name: "👋" },
    message: { id: "msg-1", channelId: "ch-1", guildId: "guild-1" },
  };

  it("publishes a packet that parses against PacketSchema", async () => {
    const { listeners, publish } = capture(event.bind as never);
    await listeners.get(discordEvent)!(reaction, { id: "user-1", username: "alice", bot: false });

    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    expect(packet.type).toBe(event.type);
    expect(packet.data).toMatchObject({
      messageId: "msg-1",
      channelId: "ch-1",
      guildId: "guild-1",
      emoji: { id: null, name: "👋" },
      creator: { id: "user-1", username: "alice" },
    });
    expect(getDedupKey(packet)).toBe(`${keyPrefix}:msg-1:user-1:👋`);
  });

  it("ignores bot reactors", async () => {
    const { listeners, publish } = capture(event.bind as never);
    await listeners.get(discordEvent)!(reaction, { id: "b", username: "bot", bot: true });
    expect(publish).not.toHaveBeenCalled();
  });

  it("falls back for custom emoji without a name and users without a username", async () => {
    const { listeners, publish } = capture(event.bind as never);
    await listeners.get(discordEvent)!(
      { ...reaction, emoji: { id: "emoji-1", name: null } },
      { id: "user-1", username: undefined, bot: false },
    );
    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    expect(packet.data).toMatchObject({
      emoji: { id: "emoji-1", name: "" },
      creator: { id: "user-1", username: "unknown" },
    });
  });
});

describe("messageDeleteEvent.bind", () => {
  it("publishes a packet that parses against PacketSchema", async () => {
    const { listeners, publish } = capture(messageDeleteEvent.bind);
    await listeners.get(Events.MessageDelete)!({
      id: "msg-1",
      channelId: "ch-1",
      guildId: "guild-1",
    });

    const packet = PacketSchema.parse(publish.mock.calls[0]![0]);
    expect(packet.type).toBe("GATEWAY_MESSAGE_DELETE");
    expect(getDedupKey(packet)).toBe("del:msg-1");
  });

  it("ignores DM deletions (no guildId)", async () => {
    const { listeners, publish } = capture(messageDeleteEvent.bind);
    await listeners.get(Events.MessageDelete)!({ id: "m", channelId: "c", guildId: null });
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("packetEvents table", () => {
  it("has a unique wire type and kind per event", () => {
    const types = packetEvents.map((event) => event.type);
    const kinds = packetEvents.map((event) => event.kind);
    expect(new Set(types).size).toBe(types.length);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("bindGatewayEvents attaches every event's listener", async () => {
    const registered: string[] = [];
    const client = {
      on: (event: string) => {
        registered.push(event);
      },
    } as unknown as Client;
    bindGatewayEvents(client, vi.fn().mockResolvedValue(undefined));
    expect(registered).toEqual([
      Events.MessageCreate,
      Events.MessageReactionAdd,
      Events.MessageReactionRemove,
      Events.MessageDelete,
    ]);
  });
});
