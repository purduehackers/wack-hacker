import type { API } from "@discordjs/core/http-only";

import type { SimEventBus } from "./event-bus.ts";
import type { SimActionRow, SimEmbed, SimMessage } from "./types.ts";
import type { VirtualGuild } from "./virtual-guild.ts";

/** The fields of a Discord message body the agent layer actually sends. */
interface CoreMessageBody {
  content?: string;
  embeds?: SimEmbed[];
  components?: SimActionRow[];
}

const EPHEMERAL_FLAG = 64;

// Ephemeral follow-ups have no real channel; pin them to a sentinel so the UI
// can route them to the active channel view if it chooses.
const SIM_INTERACTION_CHANNEL = "interaction";

/** Project a virtual message onto the Discord `APIMessage` shape callers read. */
function buildApiMessage(guild: VirtualGuild, message: SimMessage) {
  const member = guild.getMember(message.authorId);
  return {
    id: message.id,
    channel_id: message.channelId,
    content: message.content,
    timestamp: message.createdAt,
    embeds: message.embeds,
    components: message.components,
    author: {
      id: message.authorId,
      username: member?.username ?? (message.authorKind === "bot" ? "wack-hacker" : "user"),
      global_name: member?.displayName,
      bot: message.authorKind === "bot",
    },
  };
}

function buildChannels(guild: VirtualGuild, bus: SimEventBus) {
  return {
    createMessage: async (channelId: string, body: CoreMessageBody) => {
      const message = guild.createMessage(channelId, {
        authorId: guild.botUserId,
        authorKind: "bot",
        content: typeof body.content === "string" ? body.content : "",
        embeds: body.embeds,
        components: body.components,
      });
      bus.emit({ type: "message.create", message });
      return buildApiMessage(guild, message);
    },

    editMessage: async (channelId: string, messageId: string, body: CoreMessageBody) => {
      const message = guild.editMessage(channelId, messageId, {
        content: body.content,
        embeds: body.embeds,
        components: body.components,
      });
      bus.emit({
        type: "message.edit",
        messageId,
        channelId,
        content: message.content,
        embeds: message.embeds,
        components: message.components,
        editedAt: message.editedAt!,
      });
      return buildApiMessage(guild, message);
    },

    getMessage: async (channelId: string, messageId: string) => {
      const message = guild.getMessage(channelId, messageId);
      return message ? buildApiMessage(guild, message) : undefined;
    },

    getMessages: async (channelId: string, query?: { limit?: number }) =>
      guild.listMessages(channelId, query?.limit ?? 50).map((m) => buildApiMessage(guild, m)),

    createThread: async (channelId: string, body: { name: string }, messageId?: string) => {
      const thread = guild.createThread(channelId, body.name);
      bus.emit({
        type: "channel.create",
        channelId: thread.id,
        name: thread.name,
        kind: "thread",
        parentId: channelId,
        starterMessageId: messageId,
      });
      return { id: thread.id, name: thread.name };
    },

    deleteMessage: async (channelId: string, messageId: string) => {
      guild.deleteMessage(channelId, messageId);
      bus.emit({ type: "message.delete", messageId, channelId });
    },

    addMessageReaction: async (channelId: string, messageId: string, emoji: string) => {
      guild.addReaction(channelId, messageId, emoji, true);
      bus.emit({ type: "reaction.add", messageId, channelId, emoji, byBot: true });
    },

    deleteOwnMessageReaction: async (channelId: string, messageId: string, emoji: string) => {
      guild.removeReaction(channelId, messageId, emoji, true);
      bus.emit({ type: "reaction.remove", messageId, channelId, emoji, byBot: true });
    },

    get: async (channelId: string) => {
      const channel = guild.getChannel(channelId);
      return { id: channelId, name: channel?.name ?? "unknown-channel" };
    },
  };
}

function buildInteractions(guild: VirtualGuild, bus: SimEventBus) {
  return {
    // The approval click handler replies to the interaction with ephemeral
    // rejections (flags: 64); render those as ephemeral messages.
    followUp: async (
      _appId: string,
      _token: string,
      body: CoreMessageBody & { flags?: number },
    ) => {
      const message = guild.createMessage(SIM_INTERACTION_CHANNEL, {
        authorId: guild.botUserId,
        authorKind: "bot",
        content: typeof body.content === "string" ? body.content : "",
        ephemeral: (body.flags ?? 0) === EPHEMERAL_FLAG,
      });
      bus.emit({ type: "message.create", message });
      return buildApiMessage(guild, message);
    },
  };
}

/**
 * A fake `@discordjs/core` `API` that records everything into a
 * {@link VirtualGuild} and emits {@link SimEventBus} events instead of calling
 * Discord. This is transport A: the surface `streamTurn` → `MessageRenderer`
 * uses for the orchestrator's own reply, plus the mention-handler pre-stream
 * calls (thread create, placeholder) and the approval click handler the
 * simulator drives. Cast through `unknown` to `API` — only the methods the
 * agent layer touches are implemented.
 */
export function createFakeCoreAPI(guild: VirtualGuild, bus: SimEventBus): API {
  return {
    channels: buildChannels(guild, bus),
    interactions: buildInteractions(guild, bus),
  } as unknown as API;
}
