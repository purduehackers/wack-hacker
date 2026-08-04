/**
 * Mirrors public channel messages to the Purdue Hackers dashboard.
 *
 * Discord markdown is rendered to HTML here rather than on the dashboard,
 * because only the bot can resolve what the mentions in a message actually
 * refer to — `<@123>` is a name, `<#456>` is a channel, `<@&789>` is a role with
 * a colour. The dashboard has no Discord credentials, so it receives both the
 * raw markdown and the rendered HTML.
 *
 * Internal categories are excluded. That check is the only thing standing
 * between a private channel and a public webpage, which is why it runs before
 * anything else and fails closed: an unresolvable category is treated as
 * internal rather than public.
 */

import {
  type Resolver,
  discordRemarkRehypeHandlers,
  remarkDiscord,
} from "@purduehackers/discord-markdown-utils";
import { DISCORD_IDS } from "@repo/shared/discord";
import { Transient } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import { upstreamRetry } from "@repo/shared/result/retry";
import type { Client, Message } from "discord.js";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { defineEvent } from "../framework/events.ts";

export const DASHBOARD_URL = "https://api.purduehackers.com/discord/bot";

/** Indiana, matching how timestamps read to people in the room. */
const DISPLAY_TIMEZONE = "America/Indiana/Indianapolis";

/**
 * Hydrates Discord mention nodes from the REST API.
 *
 * Every method answers `null` on failure so the renderer falls back to a
 * generic form. A deleted role or a member who left must not stop the whole
 * message from being mirrored.
 */
export function createResolver(client: Client, guildId: string): Resolver {
  return {
    user: async ({ id }) => {
      const guild = await client.guilds.fetch(guildId).catch(() => undefined);
      const member = await guild?.members.fetch(id).catch(() => undefined);
      // oxlint-disable-next-line unicorn/no-null -- the resolver contract uses null for "unresolved"
      return member?.nickname ?? member?.user.globalName ?? member?.user.username ?? null;
    },

    channel: async ({ id }) => {
      const channel = await client.channels.fetch(id).catch(() => undefined);
      // oxlint-disable-next-line unicorn/no-null -- resolver contract
      if (!channel || !("name" in channel) || channel.name === null) return null;
      return channel.name;
    },

    role: async ({ id }) => {
      const guild = await client.guilds.fetch(guildId).catch(() => undefined);
      const role = await guild?.roles.fetch(id).catch(() => undefined);
      // oxlint-disable-next-line unicorn/no-null -- resolver contract
      if (!role) return null;
      // Discord uses 0 for "no colour", which must not render as #000000.
      const color = role.color === 0 ? undefined : `#${role.color.toString(16).padStart(6, "0")}`;
      return color === undefined ? { name: role.name } : { name: role.name, color };
    },

    emoji: async ({ id, animated }) =>
      `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`,

    timestamp: async ({ date }) => date.toLocaleString("en-us", { timeZone: DISPLAY_TIMEZONE }),
  };
}

export async function renderHtml(content: string, resolver: Resolver): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDiscord, { resolver })
    .use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
    .use(rehypeStringify);

  return String(await processor.process(content));
}

/**
 * Whether a message may be mirrored publicly.
 *
 * Fails closed. A message whose category cannot be determined is treated as
 * internal, because the cost of wrongly publishing a private message is far
 * higher than the cost of missing a public one.
 */
export function isPubliclyMirrorable(message: Message): boolean {
  if (!message.inGuild()) return false;

  const parent = message.channel.isThread() ? message.channel.parent : message.channel;
  if (!parent) return false;

  const { parentId } = parent;
  if (parentId === null) return true;
  return !DISCORD_IDS.categories.INTERNAL.has(parentId);
}

export function emitDashboardMessage(deps: { readonly apiToken: string }) {
  return defineEvent({
    name: "emit-dashboard-message",
    kind: "message",
    dedupKey: (message) => message.id,
    handle: async (message) => {
      if (!isPubliclyMirrorable(message)) return Result.ok(undefined);
      if (!message.inGuild()) return Result.ok(undefined);

      const html = await renderHtml(
        message.content,
        createResolver(message.client, message.guildId),
      );

      return Result.tryPromise(
        {
          try: async () => {
            const response = await fetch(DASHBOARD_URL, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${deps.apiToken}`,
              },
              body: JSON.stringify({
                id: message.id,
                channel: { id: message.channelId, name: message.channel.name },
                author: {
                  id: message.author.id,
                  name: message.member?.displayName ?? message.author.username,
                  avatarHash: message.author.avatar,
                },
                timestamp: message.createdAt.toISOString(),
                content: { markdown: message.content, html },
                attachments: [...message.attachments.values()].map((a) => a.url),
              }),
            });

            if (!response.ok) {
              throw new Transient({
                operation: "forward to dashboard",
                detail: `${response.status} ${(await response.text().catch(() => "")).slice(0, 200)}`,
              });
            }
            return undefined;
          },
          catch: (cause) =>
            cause instanceof Transient
              ? cause
              : new Transient({
                  operation: "forward to dashboard",
                  detail: cause instanceof Error ? cause.message : String(cause),
                }),
        },
        upstreamRetry,
      );
    },
  });
}
