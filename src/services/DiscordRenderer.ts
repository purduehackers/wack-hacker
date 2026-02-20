import type { Client } from "discord.js";
import type { Parent, Text, Element, RootContent } from "hast";
import type { Processor } from "unified";
import type { Node } from "unist";

import { Effect } from "effect";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { DiscordRendererError } from "../errors";
import { Discord } from "./Discord";

type Mention =
    | { readonly type: "user" | "role" | "channel"; readonly id: string }
    | {
          readonly type: "emoji";
          readonly animated: boolean;
          readonly name: string;
          readonly id: string;
      }
    | { readonly type: "timestamp"; readonly epochSeconds: number };

const ENTITY_PREFIX_MAP: Record<string, "user" | "channel" | "role"> = {
    "@": "user",
    "@!": "user",
    "#": "channel",
    "@&": "role",
};

function remarkAutolink(this: Processor) {
    const data = this.data();
    add("micromarkExtensions", gfmAutolinkLiteral());
    add("fromMarkdownExtensions", gfmAutolinkLiteralFromMarkdown());

    function add(field: Exclude<keyof typeof data, "settings">, value: any) {
        const list = data[field] ? data[field] : (data[field] = []);
        list.push(value);
    }
}

async function hydrateMention(
    client: Client<true>,
    element: Element,
    mention: Mention,
): Promise<void> {
    if (mention.type === "user") {
        const user = await client.users.fetch(mention.id).catch(() => null);
        const name = user?.globalName ?? user?.username ?? "unknown user";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-user"],
        };
        element.children = [{ type: "text", value: `@${name}` }];
    } else if (mention.type === "channel") {
        const channel = await client.channels.fetch(mention.id).catch(() => null);
        const name = (channel && "name" in channel ? channel.name : null) ?? "unknown-channel";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-channel"],
        };
        element.children = [{ type: "text", value: `#${name}` }];
    } else if (mention.type === "role") {
        let role = null;
        for (const guild of client.guilds.cache.values()) {
            role = guild.roles.cache.get(mention.id) ?? null;
            if (!role) {
                role = await guild.roles.fetch(mention.id).catch(() => null);
            }
            if (role) break;
        }
        const name = role?.name ?? "unknown-role";
        const color = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : null;
        const style =
            color && color !== "#000000" ? `color: ${color}; background: ${color}20;` : "";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-role"],
            style,
        };
        element.children = [{ type: "text", value: `@${name}` }];
    } else if (mention.type === "emoji") {
        const extension = mention.animated ? "gif" : "png";
        element.tagName = "img";
        element.properties = {
            src: `https://cdn.discordapp.com/emojis/${mention.id}.${extension}`,
            alt: `:${mention.name}:`,
            className: ["discord-emoji"],
        };
    } else if (mention.type === "timestamp") {
        const date = new Date(mention.epochSeconds * 1000);
        element.tagName = "time";
        element.children = [
            {
                type: "text",
                value: date.toLocaleString("en-us", {
                    timeZone: "America/Indianapolis",
                }),
            },
        ];
    }
}

function rehypeDiscordPlugin(client: Client<true>) {
    return function rehypeDiscord() {
        return async (tree: Node) => {
            const promises: Promise<unknown>[] = [];

            visit(tree, "text", (node: Text, index: number, parent: Parent) => {
                const origText = node.value;

                const entityMatches = [...origText.matchAll(/<(@!?|#|@&)(\d+)>/g)].map((match) => ({
                    match,
                    type: "entity" as const,
                }));
                const emojiMatches = [...origText.matchAll(/<(a?):(\w+):(\d+)>/g)].map((match) => ({
                    match,
                    type: "emoji" as const,
                }));
                const timestampMatches = [...origText.matchAll(/<t:(\d+)(?::[tTdDfFR])?>/g)].map(
                    (match) => ({ match, type: "timestamp" as const }),
                );

                const allMatches = [...entityMatches, ...emojiMatches, ...timestampMatches];
                if (allMatches.length === 0) return;
                allMatches.sort((a, b) => a.match.index! - b.match.index!);

                let lastMatchEnd = 0;
                const components: RootContent[] = [];

                for (const { match, type } of allMatches) {
                    const matchIndex = match.index!;

                    if (matchIndex > lastMatchEnd) {
                        components.push({
                            type: "text",
                            value: origText.slice(lastMatchEnd, matchIndex),
                        } satisfies Text);
                    }

                    let mention: Mention;
                    if (type === "entity") {
                        mention = { type: ENTITY_PREFIX_MAP[match[1]!]!, id: match[2]! };
                    } else if (type === "emoji") {
                        mention = {
                            type: "emoji",
                            animated: match[1] === "a",
                            name: match[2]!,
                            id: match[3]!,
                        };
                    } else {
                        mention = { type: "timestamp", epochSeconds: parseInt(match[1]!) };
                    }

                    const element = { type: "element" } as Element;
                    components.push(element);
                    promises.push(hydrateMention(client, element, mention));

                    lastMatchEnd = matchIndex + match[0].length;
                }

                if (lastMatchEnd < origText.length) {
                    components.push({
                        type: "text",
                        value: origText.slice(lastMatchEnd),
                    } satisfies Text);
                }

                parent.children.splice(index, 1, ...components);
            });

            await Promise.all(promises);
        };
    };
}

export class DiscordRenderer extends Effect.Service<DiscordRenderer>()("DiscordRenderer", {
    dependencies: [Discord.Default],

    scoped: Effect.gen(function* () {
        const discord = yield* Discord;
        const processor = unified()
            .use(remarkParse)
            .use(remarkAutolink)
            .use(remarkRehype)
            .use(rehypeSanitize)
            .use(rehypeDiscordPlugin(discord.client))
            .use(rehypeStringify);

        yield* Effect.logDebug("discord renderer service initialized", {
            service_name: "DiscordRenderer",
        });

        const render = Effect.fn("DiscordRenderer.render")(function* (markdown: string) {
            const startTime = Date.now();

            yield* Effect.annotateCurrentSpan({
                markdown_length: markdown.length,
            });

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
