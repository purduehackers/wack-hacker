import {
  discordRemarkRehypeHandlers,
  remarkDiscord,
  type Resolver,
} from "@purduehackers/discord-markdown-utils";
import { log } from "evlog";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { z } from "zod";

import type { HandlerContext } from "@/bot/types";

import { defineEvent } from "@/bot/events/define";
import { env } from "@/env";
import { DISCORD_IDS } from "@/lib/protocol/constants";

const DiscordMessageSchema = z.object({
  id: z.string(),
  channel: z.object({
    id: z.string(),
    name: z.string(),
  }),
  author: z.object({
    id: z.string(),
    name: z.string(),
    avatarHash: z.string().nullable(),
  }),
  timestamp: z.iso.datetime({ offset: true }),
  content: z.object({
    markdown: z.string(),
    html: z.string(),
  }),
  attachments: z.array(z.string()).default([]),
});

/**
 * Build a `Resolver` that hydrates Discord mention nodes from the REST API.
 * Every method returns `null` on fetch failure so the library can fall back
 * to a generic render.
 */
function createResolver(ctx: HandlerContext, guildId: string): Resolver {
  return {
    async user({ id }) {
      const member = await ctx.discord.guilds.getMember(guildId, id).catch(() => null);
      if (!member) return null;
      return member.nick ?? member.user.global_name ?? member.user.username ?? null;
    },

    async channel({ id }) {
      const channel = await ctx.discord.channels.get(id).catch(() => null);
      if (!channel) return null;
      return "name" in channel && channel.name ? channel.name : null;
    },

    async role({ id }) {
      const role = await ctx.discord.guilds.getRole(guildId, id).catch(() => null);
      if (!role) return null;
      const color =
        role.color && role.color !== 0 ? `#${role.color.toString(16).padStart(6, "0")}` : undefined;
      return { name: role.name, color };
    },

    async emoji({ id, animated }) {
      return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
    },

    async timestamp({ date }) {
      return date.toLocaleString("en-us", { timeZone: "America/Indianapolis" });
    },
  };
}

export const dashboard = defineEvent({
  type: "message",
  async handle(packet, ctx) {
    const { id, author, channel, categoryId, content, timestamp, attachments, guildId } =
      packet.data;
    if (author.bot) return;
    if (categoryId && DISCORD_IDS.categories.INTERNAL.has(categoryId)) return;

    const resolver = createResolver(ctx, guildId);
    const processor = unified()
      .use(remarkParse)
      .use(remarkDiscord, { resolver })
      .use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
      .use(rehypeStringify);

    const html = String(await processor.process(content));

    const payload = DiscordMessageSchema.parse({
      id,
      channel: { id: channel.id, name: channel.name },
      author: {
        id: author.id,
        name: author.nickname ?? author.username,
        avatarHash: author.avatarHash ?? null,
      },
      timestamp,
      content: { markdown: content, html },
      attachments: attachments.map((a) => a.url),
    });

    try {
      await fetch(env.DASHBOARD_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.PHACK_API_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      log.warn("dashboard", `Failed to forward message: ${String(err)}`);
    }
  },
});
