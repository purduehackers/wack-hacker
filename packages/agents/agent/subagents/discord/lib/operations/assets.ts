/**
 * Discord asset administration — custom emojis, stickers and webhooks.
 *
 * These are ordinary provider calls against Discord's REST API, exactly like
 * Linear or Notion: the agent holds its own Discord identity rather than asking
 * the bot to manage guild assets on its behalf.
 */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import type { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import {
  Routes,
  StickerFormatType,
  type RESTGetAPIChannelWebhooksResult,
  type RESTGetAPIGuildEmojiResult,
  type RESTGetAPIGuildEmojisResult,
  type RESTGetAPIGuildStickersResult,
  type RESTGetAPIGuildWebhooksResult,
  type RESTPatchAPIGuildEmojiJSONBody,
  type RESTPatchAPIGuildEmojiResult,
  type RESTPatchAPIGuildStickerJSONBody,
  type RESTPatchAPIGuildStickerResult,
  type RESTPatchAPIWebhookJSONBody,
  type RESTPatchAPIWebhookResult,
  type RESTPostAPIChannelWebhookJSONBody,
  type RESTPostAPIChannelWebhookResult,
  type RESTPostAPIGuildEmojiJSONBody,
  type RESTPostAPIGuildEmojiResult,
  type RESTPostAPIGuildStickerFormDataBody,
  type RESTPostAPIGuildStickerResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../lib/policy/domain-tools.ts";
import { compact, discordArray, discordObject, discordRest } from "../rest.ts";
import {
  channelId,
  discordSnowflakeSchema,
  download,
  empty,
  guildChannel,
  httpUrl,
  imageDataUri,
  responseString,
  roleId,
} from "./common.ts";

/** Discord rejects any other character in a custom emoji's name. */
const emojiName = z
  .stringFormat("discord-emoji-name", /^[A-Za-z0-9_]+$/u)
  .min(2)
  .max(32);

type EmojiResult = RESTGetAPIGuildEmojisResult[number];
type StickerResult = RESTGetAPIGuildStickersResult[number];
/** Webhook tokens/URLs are deliberately never projected to the model. */
type WebhookResult = RESTGetAPIGuildWebhooksResult[number];

function summarizeEmoji(emoji: EmojiResult) {
  const animated = emoji.animated ?? false;
  const id = discordSnowflakeSchema.safeParse(emoji.id).data;
  return {
    id: emoji.id,
    name: emoji.name,
    animated,
    url:
      id === undefined
        ? null
        : `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`,
    roles: emoji.roles ?? [],
    createdAt: emoji.id,
  };
}

function summarizeSticker(sticker: StickerResult) {
  const id = discordSnowflakeSchema.safeParse(sticker.id).data;
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description ?? null,
    tags: sticker.tags,
    formatType: sticker.format_type,
    available: sticker.available,
    url:
      id === undefined
        ? null
        : `https://cdn.discordapp.com/stickers/${id}.${sticker.format_type === StickerFormatType.Lottie ? "json" : "png"}`,
  };
}

function summarizeWebhook(webhook: WebhookResult) {
  const id = discordSnowflakeSchema.safeParse(webhook.id).data;
  const avatar = responseString.safeParse(webhook.avatar).data;
  return {
    id: webhook.id,
    name: webhook.name,
    channelId: webhook.channel_id,
    avatar:
      id === undefined || avatar === undefined
        ? null
        : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`,
    createdAt: webhook.id,
  };
}

async function guildWebhook(rest: REST, id: string): Promise<WebhookResult> {
  const webhook = discordObject<WebhookResult>(await rest.get(Routes.webhook(id)), "get webhook");
  if (webhook.guild_id !== DISCORD_GUILD_ID) {
    throw new UpstreamError({
      service: "Discord",
      status: 403,
      detail: "webhook is outside the managed guild",
    });
  }
  return webhook;
}

function stickerFilename(contentType: string): string {
  switch (contentType) {
    case "application/json":
      return "sticker.json";
    case "image/gif":
      return "sticker.gif";
    case "image/apng":
    case "image/png":
      return "sticker.png";
    default:
      throw new UpstreamError({
        service: "image-source",
        status: 415,
        detail: `unsupported sticker content type ${contentType}`,
      });
  }
}

export const ASSET_OPERATIONS = {
  list_emojis: defineTool({
    access: { risk: "read" },
    description:
      "List all custom emojis in the server. Returns emoji IDs, names, animation status, image URLs, and role restrictions.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      return discordArray<RESTGetAPIGuildEmojisResult>(
        await rest.get(Routes.guildEmojis(DISCORD_GUILD_ID)),
        "list guild emojis",
      ).map(summarizeEmoji);
    },
  }),

  create_emoji: defineTool({
    access: { risk: "write" },
    description:
      "Create a custom emoji from an image URL. The image must be PNG, JPG, or GIF and under 256KB. You can restrict usage to specific roles.",
    input: z.strictObject({
      name: emojiName,
      url: httpUrl,
      roles: z.array(roleId).max(100).optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      const created = discordObject<RESTPostAPIGuildEmojiResult>(
        await rest.post(Routes.guildEmojis(DISCORD_GUILD_ID), {
          body: compact<RESTPostAPIGuildEmojiJSONBody>({
            name: input.name,
            image: await imageDataUri(input.url),
            roles: input.roles,
          }),
        }),
        "create guild emoji",
      );
      return summarizeEmoji(created);
    },
  }),

  edit_emoji: defineTool({
    access: { risk: "write" },
    description:
      "Edit a custom emoji's name or role restrictions. Pass an empty roles array to make the emoji available to everyone.",
    input: z.strictObject({
      emoji_id: discordSnowflakeSchema,
      name: emojiName.optional(),
      roles: z.array(roleId).max(100).optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      return summarizeEmoji(
        discordObject<RESTPatchAPIGuildEmojiResult>(
          await rest.patch(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id), {
            body: compact<RESTPatchAPIGuildEmojiJSONBody>({ name: input.name, roles: input.roles }),
          }),
          "edit guild emoji",
        ),
      );
    },
  }),

  delete_emoji: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a custom emoji. This is irreversible and will remove the emoji from all messages where it was used (they will show as unknown emoji).",
    input: z.strictObject({ emoji_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      const emoji = discordObject<RESTGetAPIGuildEmojiResult>(
        await rest.get(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id)),
        "get guild emoji",
      );
      await rest.delete(Routes.guildEmoji(DISCORD_GUILD_ID, input.emoji_id));
      return { success: true, deleted: emoji.name ?? input.emoji_id };
    },
  }),

  list_stickers: defineTool({
    access: { risk: "read" },
    description:
      "List all custom stickers in the Discord server. Returns each sticker's ID, name, description, tags, and URL.",
    input: empty,
    execute: async () => {
      const rest = discordRest();
      return discordArray<RESTGetAPIGuildStickersResult>(
        await rest.get(Routes.guildStickers(DISCORD_GUILD_ID)),
        "list guild stickers",
      ).map(summarizeSticker);
    },
  }),

  create_sticker: defineTool({
    access: { risk: "write" },
    description:
      "Upload a new custom sticker. Formats: PNG, APNG, or Lottie JSON. Max 512KB, 320x320px recommended. Requires a name (2-30 chars), tag (autocomplete suggestion, 2-200 chars), and image URL.",
    input: z.strictObject({
      name: z.string().trim().min(2).max(30),
      description: z.union([z.literal(""), z.string().trim().min(2).max(100)]).default(""),
      tags: z.string().trim().min(2).max(200),
      url: httpUrl,
    }),
    execute: async (input) => {
      const rest = discordRest();
      const file = await download(input.url, 512 * 1_024, [
        "image/png",
        "image/apng",
        "image/gif",
        "application/json",
      ]);
      const sticker = discordObject<RESTPostAPIGuildStickerResult>(
        await rest.post(Routes.guildStickers(DISCORD_GUILD_ID), {
          body: compact<Omit<RESTPostAPIGuildStickerFormDataBody, "file">>({
            name: input.name,
            description: input.description,
            tags: input.tags,
          }),
          files: [
            {
              data: file.bytes,
              name: stickerFilename(file.contentType),
              contentType: file.contentType,
            },
          ],
        }),
        "create guild sticker",
      );
      return summarizeSticker(sticker);
    },
  }),

  edit_sticker: defineTool({
    access: { risk: "write" },
    description: "Edit a custom sticker's name, description, or tag.",
    input: z.strictObject({
      sticker_id: discordSnowflakeSchema,
      name: z.string().trim().min(2).max(30).optional(),
      description: z.string().trim().min(2).max(100).nullable().optional(),
      tags: z.string().trim().min(2).max(200).optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      return summarizeSticker(
        discordObject<RESTPatchAPIGuildStickerResult>(
          await rest.patch(Routes.guildSticker(DISCORD_GUILD_ID, input.sticker_id), {
            body: compact<RESTPatchAPIGuildStickerJSONBody>({
              name: input.name,
              description: input.description,
              tags: input.tags,
            }),
          }),
          "edit guild sticker",
        ),
      );
    },
  }),

  delete_sticker: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a custom sticker. Irreversible — all prior uses of the sticker become unresolved references.",
    input: z.strictObject({ sticker_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      await rest.delete(Routes.guildSticker(DISCORD_GUILD_ID, input.sticker_id));
      return { deleted: true, sticker_id: input.sticker_id };
    },
  }),

  list_webhooks: defineTool({
    access: { risk: "read" },
    description:
      "List webhooks in the server or a specific channel. Returns webhook IDs, names, channel IDs, and avatars; webhook tokens and URLs are never exposed.",
    input: z.strictObject({ channel_id: channelId.optional() }),
    execute: async (input) => {
      const rest = discordRest();
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const path =
        input.channel_id === undefined
          ? Routes.guildWebhooks(DISCORD_GUILD_ID)
          : Routes.channelWebhooks(input.channel_id);
      return discordArray<RESTGetAPIGuildWebhooksResult | RESTGetAPIChannelWebhooksResult>(
        await rest.get(path),
        "list webhooks",
      ).map(summarizeWebhook);
    },
  }),

  create_webhook: defineTool({
    access: { risk: "destructive" },
    description:
      "Create a webhook in a channel. Returns its non-secret ID, name, and channel; the webhook token and URL are never exposed.",
    input: z.strictObject({
      channel_id: channelId,
      name: z.string().trim().min(1).max(80),
      avatar: httpUrl.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        discordObject<RESTPostAPIChannelWebhookResult>(
          await rest.post(Routes.channelWebhooks(input.channel_id), {
            body: compact<RESTPostAPIChannelWebhookJSONBody>({ name: input.name, avatar }),
          }),
          "create channel webhook",
        ),
      );
    },
  }),

  edit_webhook: defineTool({
    access: { risk: "destructive" },
    description: "Edit a webhook's name, avatar, or move it to a different channel.",
    input: z.strictObject({
      webhook_id: discordSnowflakeSchema,
      name: z.string().trim().min(1).max(80).optional(),
      avatar: httpUrl.optional(),
      channel_id: channelId.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildWebhook(rest, input.webhook_id);
      if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
      const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
      return summarizeWebhook(
        discordObject<RESTPatchAPIWebhookResult>(
          await rest.patch(Routes.webhook(input.webhook_id), {
            body: compact<RESTPatchAPIWebhookJSONBody>({
              name: input.name,
              avatar,
              channel_id: input.channel_id,
            }),
          }),
          "edit webhook",
        ),
      );
    },
  }),

  delete_webhook: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a webhook. This is irreversible and will break any integrations using this webhook's URL.",
    input: z.strictObject({ webhook_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      const webhook = await guildWebhook(rest, input.webhook_id);
      await rest.delete(Routes.webhook(input.webhook_id));
      return { success: true, deleted: webhook.name ?? input.webhook_id };
    },
  }),
} as const;
