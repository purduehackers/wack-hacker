import type { API } from "@discordjs/core/http-only";

import type { DiscordMessage } from "@/lib/protocol/types";

import type { MockCall, MockDiscord } from "../types";

function fakeMessage(id: string, content: string): DiscordMessage {
  return { id, content, channel_id: "ch-test" } as DiscordMessage;
}

export function createMockAPI(): MockDiscord {
  const calls: MockCall[] = [];
  let counter = 0;

  return {
    channels: {
      createMessage: async (channelId: string, body: { content: string }) => {
        calls.push({ method: "channels.createMessage", args: [channelId, body] });
        return fakeMessage(`msg-${++counter}`, body.content);
      },
      editMessage: async (channelId: string, msgId: string, body: { content: string }) => {
        calls.push({ method: "channels.editMessage", args: [channelId, msgId, body] });
        return fakeMessage(msgId, body.content);
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
      editReply: async (appId: string, token: string, body: { content: string }) => {
        calls.push({ method: "interactions.editReply", args: [appId, token, body] });
        return fakeMessage("msg-interaction", body.content);
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
