import type { Guild } from "discord.js";

import {
    discordRemarkRehypeHandlers,
    remarkDiscord,
    type Resolver,
} from "@purduehackers/discord-markdown-utils";
import { Effect } from "effect";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { DiscordRendererError } from "../errors";
import { Discord } from "./Discord";

function makeResolverForGuild(guild: Guild): Resolver {
    return {
        async user(mention) {
            const member = await guild.members.fetch(mention.id).catch(() => null);
            const name =
                member?.nickname ?? member?.user?.globalName ?? member?.user?.username ?? null;
            return name;
        },

        async channel(mention) {
            return await guild.channels.fetch(mention.id).then(
                (channel) => (channel ? channel.name : null),
                () => null,
            );
        },

        async role(mention) {
            const role = await guild.roles.fetch(mention.id).catch(() => null);
            const name = role?.name;
            if (!name) return null;
            const color = role?.color
                ? `#${role.colors.primaryColor.toString(16).padStart(6, "0")}`
                : undefined;
            return { name, color };
        },

        async emoji(mention) {
            const emoji = await guild.emojis.fetch(mention.id).catch(() => null);
            return emoji?.imageURL({ animated: mention.animated }) ?? null;
        },

        async timestamp(mention) {
            return mention.date.toLocaleString("en-us", {
                timeZone: "America/Indianapolis",
            });
        },
    };
}

export class DiscordRenderer extends Effect.Service<DiscordRenderer>()("DiscordRenderer", {
    dependencies: [Discord.Default],

    scoped: Effect.gen(function* () {
        const discord = yield* Discord;

        yield* Effect.logDebug("discord renderer service initialized", {
            service_name: "DiscordRenderer",
        });

        const render = Effect.fn("DiscordRenderer.render")(function* (
            guildId: string,
            markdown: string,
        ) {
            const startTime = Date.now();

            yield* Effect.annotateCurrentSpan({
                markdown_length: markdown.length,
            });

            const guild = discord.client.guilds.cache.get(guildId);
            if (guild === undefined) {
                return yield* Effect.fail(new DiscordRendererError({ cause: "unknown guild ID" }));
            }

            const resolver = makeResolverForGuild(guild);
            const processor = unified()
                .use(remarkParse)
                .use(remarkDiscord, { resolver })
                .use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
                // .use(rehypeSanitize)
                .use(rehypeStringify);

            const result = yield* Effect.tryPromise({
                try: () => processor.process(markdown),
                catch: (cause) => new DiscordRendererError({ cause }),
            });

            const html = result.toString();
            const duration_ms = Date.now() - startTime;

            yield* Effect.annotateCurrentSpan({
                html_length: html.length,
                duration_ms,
            });

            yield* Effect.logInfo("discord markdown rendered to html", {
                service_name: "DiscordRenderer",
                method: "render",
                markdown_length: markdown.length,
                html_length: html.length,
                duration_ms,
            });

            return html;
        });

        return { render } as const;
    }).pipe(Effect.annotateLogs({ service: "DiscordRenderer" })),
}) {}
