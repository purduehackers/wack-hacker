import { Events } from "discord.js";
import { z } from "zod";

import { isTextChannel } from "../utils.ts";
import { definePacketEvent } from "./define.ts";
import { guardEvent } from "./guard.ts";

const DiscordTimestamp = z.iso.datetime({ offset: true });

const MessageDataAttachment = z.object({
  id: z.string(),
  url: z.string(),
  filename: z.string(),
  contentType: z.string().optional(),
  size: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const MessageDataAuthor = z.object({
  id: z.string(),
  username: z.string(),
  nickname: z.string().optional(),
  bot: z.boolean().optional(),
  avatarHash: z.string().optional(),
});

const MessageDataChannel = z.object({
  id: z.string(),
  name: z.string(),
});

const MessageDataThread = z.object({
  parentId: z.string(),
  parentName: z.string(),
});

const MessageSnapshot = z.object({
  content: z.string().optional(),
  attachments: z.array(MessageDataAttachment).optional(),
});

const MessageCreateData = z.object({
  id: z.string(),
  attachments: z.array(MessageDataAttachment),
  author: MessageDataAuthor,
  channel: MessageDataChannel,
  thread: MessageDataThread.optional(),
  guildId: z.string(),
  content: z.string(),
  timestamp: DiscordTimestamp,
  memberRoles: z.array(z.string()).optional(),
  flags: z.number().optional(),
  categoryId: z.string().optional(),
  forwardedSnapshots: z.array(MessageSnapshot).optional(),
  mentions: z.array(z.string()).default([]),
  reference: z
    .object({
      messageId: z.string(),
      channelId: z.string().optional(),
      authorId: z.string().optional(),
    })
    .optional(),
});

function serializeAttachment(a: {
  id: string;
  url: string;
  name: string;
  contentType: string | null;
  size: number;
  width: number | null;
  height: number | null;
}) {
  return {
    id: a.id,
    url: a.url,
    filename: a.name,
    contentType: a.contentType ?? undefined,
    size: a.size,
    width: a.width ?? undefined,
    height: a.height ?? undefined,
  };
}

export const messageCreateEvent = definePacketEvent({
  type: "GATEWAY_MESSAGE_CREATE",
  kind: "message",
  data: MessageCreateData,
  dedupKey: (packet) => `msg:${packet.data.id}`,
  bind: (client, publish) => {
    client.on(Events.MessageCreate, (message) =>
      guardEvent("messageCreate", async () => {
        if (message.author.bot || !isTextChannel(message.channel)) return;

        await publish({
          type: "GATEWAY_MESSAGE_CREATE",
          timestamp: new Date(),
          data: {
            id: message.id,
            attachments: message.attachments.map(serializeAttachment),
            author: {
              id: message.author.id,
              username: message.author.username,
              nickname: message.author.displayName,
              bot: message.author.bot,
              avatarHash: message.author.avatar ?? undefined,
            },
            channel: { id: message.channel.id, name: message.channel.name },
            thread:
              message.channel.isThread() && message.channel.parent
                ? {
                    parentId: message.channel.parentId!,
                    parentName: message.channel.parent.name,
                  }
                : undefined,
            content: message.content,
            guildId: message.guildId!,
            timestamp: message.createdAt.toISOString(),
            memberRoles: [...(message.member?.roles.cache.keys() ?? [])],
            flags: message.flags?.bitfield,
            categoryId: message.channel.isThread()
              ? undefined
              : (message.channel.parentId ?? undefined),
            forwardedSnapshots: (message as any).messageSnapshots?.map((s: any) => ({
              content: s.content ?? undefined,
              attachments: s.attachments?.map(serializeAttachment),
            })),
            mentions: [...message.mentions.users.keys()],
            reference: message.reference?.messageId
              ? {
                  messageId: message.reference.messageId,
                  channelId: message.reference.channelId ?? undefined,
                  authorId: message.mentions.repliedUser?.id,
                }
              : undefined,
          },
        });
      }),
    );
  },
});
