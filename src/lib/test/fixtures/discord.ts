import type { API } from "@discordjs/core/http-only";

import type { SlashCommandContext } from "@/bot/commands/types";
import type { DiscordMessage } from "@/lib/protocol/types";

import { InteractionType } from "@/lib/protocol/constants";

import type { FakeSlashCommandCtxOptions, MockCall, MockDiscord } from "../types";

function fakeMessage(id: string, content: string): DiscordMessage {
  return { id, content, channel_id: "ch-test" } as DiscordMessage;
}

type MessageBody = { content?: string; [key: string]: unknown };

export function createMockAPI(): MockDiscord {
  const calls: MockCall[] = [];
  let counter = 0;

  return {
    channels: {
      createMessage: async (channelId: string, body: MessageBody) => {
        calls.push({ method: "channels.createMessage", args: [channelId, body] });
        return fakeMessage(`msg-${++counter}`, body.content ?? "");
      },
      editMessage: async (channelId: string, msgId: string, body: MessageBody) => {
        calls.push({ method: "channels.editMessage", args: [channelId, msgId, body] });
        return fakeMessage(msgId, body.content ?? "");
      },
      getMessage: async (channelId: string, msgId: string) => {
        calls.push({ method: "channels.getMessage", args: [channelId, msgId] });
        return fakeMessage(msgId, "");
      },
      getMessages: async (channelId: string, query?: unknown) => {
        calls.push({ method: "channels.getMessages", args: [channelId, query] });
        return [] as DiscordMessage[];
      },
      deleteMessage: async (...args: unknown[]) => {
        calls.push({ method: "channels.deleteMessage", args });
      },
      addMessageReaction: async (...args: unknown[]) => {
        calls.push({ method: "channels.addMessageReaction", args });
      },
      deleteOwnMessageReaction: async (...args: unknown[]) => {
        calls.push({ method: "channels.deleteOwnMessageReaction", args });
      },
      deleteUserMessageReaction: async (...args: unknown[]) => {
        calls.push({ method: "channels.deleteUserMessageReaction", args });
      },
      pinMessage: async (...args: unknown[]) => {
        calls.push({ method: "channels.pinMessage", args });
      },
      createThread: async (channelId: string, body: { name: string }, msgId?: string) => {
        calls.push({ method: "channels.createThread", args: [channelId, body, msgId] });
        return { id: `thread-${++counter}`, name: body.name };
      },
      edit: async (...args: unknown[]) => {
        calls.push({ method: "channels.edit", args });
        return { name: "" };
      },
      get: async (channelId: string) => {
        calls.push({ method: "channels.get", args: [channelId] });
        return { id: channelId, name: "hack-night" };
      },
    },
    guilds: {
      addRoleToMember: async (...args: unknown[]) => {
        calls.push({ method: "guilds.addRoleToMember", args });
      },
      removeRoleFromMember: async (...args: unknown[]) => {
        calls.push({ method: "guilds.removeRoleFromMember", args });
      },
      getMember: async (guildId: string, memberId: string) => {
        calls.push({ method: "guilds.getMember", args: [guildId, memberId] });
        return { roles: [] };
      },
    },
    users: {
      createDM: async (recipientId: string) => {
        calls.push({ method: "users.createDM", args: [recipientId] });
        return { id: `dm-${recipientId}` };
      },
    },
    interactions: {
      editReply: async (appId: string, token: string, body: MessageBody) => {
        calls.push({ method: "interactions.editReply", args: [appId, token, body] });
        return fakeMessage("msg-interaction", body.content ?? "");
      },
      followUp: async (appId: string, token: string, body: MessageBody) => {
        calls.push({ method: "interactions.followUp", args: [appId, token, body] });
        return fakeMessage(`followup-${++counter}`, body.content ?? "");
      },
    },
    _calls: calls,
    callsTo(method: string): unknown[][] {
      return calls.filter((c) => c.method === method).map((c) => c.args);
    },
  };
}

/** Cast a MockDiscord to API for passing into production code. */
export function asAPI(mock: MockDiscord): API {
  return mock as unknown as API;
}

/** Raw Discord REST message shape used in channel-history fetch tests. */
export function fakeRawMessage(
  id: string,
  username: string,
  content: string,
  timestamp: string,
  extra: Record<string, unknown> = {},
): unknown {
  return { id, author: { username, ...extra }, content, timestamp };
}

/** Create a mock API whose `getMessages` returns the given list. */
export function withMessages(messages: unknown[]): MockDiscord {
  const mock = createMockAPI();
  mock.channels.getMessages = async () => messages as never;
  return mock;
}

/** Create a mock API whose `getMessage` returns `anchor` and `getMessages` returns `priors`. */
export function withAnchor(anchor: unknown, priors: unknown[]): MockDiscord {
  const mock = createMockAPI();
  mock.channels.getMessage = async () => anchor as never;
  mock.channels.getMessages = async () => priors as never;
  return mock;
}

/**
 * Build a `SlashCommandContext` backed by a `createMockAPI()`. Returns both
 * the ctx (for passing into command handlers) and the mock (for assertions).
 */
export function fakeSlashCommandCtx(opts: FakeSlashCommandCtxOptions = {}): {
  ctx: SlashCommandContext;
  discord: MockDiscord;
} {
  const discord = createMockAPI();
  const baseInteraction = {
    id: "i",
    application_id: "a",
    type: InteractionType.ApplicationCommand,
    token: "t",
    version: 1,
    ...opts.interaction,
  };
  const ctx: SlashCommandContext = {
    interaction: opts.noMember
      ? baseInteraction
      : {
          ...baseInteraction,
          member: {
            user: { id: opts.user?.id ?? "u", username: opts.user?.username ?? "u" },
            roles: opts.roles ?? [],
            nick: null,
          },
        },
    discord: asAPI(discord),
    options: new Map(),
  };
  return { ctx, discord };
}
