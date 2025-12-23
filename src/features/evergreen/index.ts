import type { Message } from "discord.js";

import { Effect } from "effect";

import {
    BISHOP_ROLE_ID,
    EVERGREEN_CREATE_ISSUE_STRING,
    EVERGREEN_WIKI_URL,
    EVERGREEN_WIKI_BUFFER,
    ORGANIZER_ROLE_ID,
} from "../../constants";
import { GitHub, MediaWiki } from "../../services";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const handleEvergreenIt = Effect.fn("Evergreen.handleIt")(
    function* (message: Message) {
        const startTime = Date.now();
        const github = yield* GitHub;
        const mediaWiki = yield* MediaWiki;

        if (message.author.bot) {
            yield* Effect.logDebug("message ignored: bot author", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
            });
            return;
        }

        if (message.channel.isDMBased()) {
            yield* Effect.logDebug("message ignored: dm channel", {
                user_id: message.author.id,
                message_id: message.id,
            });
            return;
        }

        const isOrganizerOrBishop = message.member?.roles.cache.some(
            (r) => r.id === ORGANIZER_ROLE_ID || r.id === BISHOP_ROLE_ID,
        );
        if (!isOrganizerOrBishop) {
            yield* Effect.logDebug("message ignored: insufficient permissions", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                has_organizer_role: false,
                has_bishop_role: false,
            });
            return;
        }

        if (!message.content.toLowerCase().startsWith(EVERGREEN_CREATE_ISSUE_STRING)) {
            yield* Effect.logDebug("message ignored: not evergreen command", {
                user_id: message.author.id,
                channel_id: message.channelId,
                message_id: message.id,
                expected_prefix: EVERGREEN_CREATE_ISSUE_STRING,
            });
            return;
        }

        yield* Effect.annotateCurrentSpan({
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
        });

        yield* Effect.logInfo("evergreen request started", {
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            has_reference: !!message.reference?.messageId,
        });

        let original: Message;

        if (!message.reference || !message.reference.messageId) {
            yield* Effect.logDebug("fetching recent messages for reference", {
                channel_id: message.channelId,
                limit: 2,
            });

            const fetchMessagesStart = Date.now();
            const messages = yield* Effect.tryPromise({
                try: () => message.channel.messages.fetch({ limit: 2 }),
                catch: (e) =>
                    new Error(
                        `Failed to fetch messages: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }).pipe(
                Effect.tapError((error) =>
                    Effect.logError("failed to fetch messages", {
                        channel_id: message.channelId,
                        error_message: error.message,
                        duration_ms: Date.now() - fetchMessagesStart,
                    }),
                ),
            );
            const [, ref] = Array.from(messages.values());
            original = ref;

            yield* Effect.logDebug("fetched message reference", {
                channel_id: message.channelId,
                original_message_id: original?.id ?? "none",
                original_author_id: original?.author.id ?? "none",
                duration_ms: Date.now() - fetchMessagesStart,
            });
        } else {
            yield* Effect.logDebug("fetching referenced message", {
                channel_id: message.channelId,
                reference_message_id: message.reference.messageId,
            });

            const fetchReferenceStart = Date.now();
            original = yield* Effect.tryPromise({
                try: () => message.channel.messages.fetch(message.reference!.messageId!),
                catch: (e) =>
                    new Error(
                        `Failed to fetch reference: ${e instanceof Error ? e.message : String(e)}`,
                    ),
            }).pipe(
                Effect.tapError((error) =>
                    Effect.logError("failed to fetch reference message", {
                        channel_id: message.channelId,
                        reference_message_id: message.reference!.messageId!,
                        error_message: error.message,
                        duration_ms: Date.now() - fetchReferenceStart,
                    }),
                ),
            );

            yield* Effect.logDebug("fetched referenced message", {
                channel_id: message.channelId,
                original_message_id: original.id,
                original_author_id: original.author.id,
                duration_ms: Date.now() - fetchReferenceStart,
            });
        }

        if (!original) {
            yield* Effect.logWarning("no original message found", {
                channel_id: message.channelId,
                message_id: message.id,
                user_id: message.author.id,
                duration_ms: Date.now() - startTime,
            });
            return;
        }

        yield* Effect.logDebug("fetching github associations", {
            user_id: message.author.id,
            original_author_id: original.author.id,
        });

        const associationsStart = Date.now();
        const associations = yield* github.getAssociations().pipe(
            Effect.tap((assocs) =>
                Effect.logDebug("github associations fetched", {
                    association_count: Object.keys(assocs).length,
                    requestor_associated: !!assocs[message.author.id],
                    original_author_associated: !!assocs[original.author.id],
                    duration_ms: Date.now() - associationsStart,
                }),
            ),
            Effect.tapError((error) =>
                Effect.logWarning("failed to fetch github associations", {
                    error_message: error instanceof Error ? error.message : String(error),
                    duration_ms: Date.now() - associationsStart,
                }),
            ),
            Effect.catchAll(() => Effect.succeed({} as Record<string, string>)),
        );

        const assignees: string[] = [
            associations[message.author.id],
            associations[original.author.id],
        ].filter(Boolean);

        const originalAuthor = associations[original.author.id] ?? original.author.tag;
        const requestor = associations[message.author.id] ?? message.author.tag;
        const originalText = original.content;
        const messageArgs = message.content.slice(EVERGREEN_CREATE_ISSUE_STRING.length);
        const messageLink = message.url;
        const channelName = (message.channel as { name?: string }).name ?? "unknown";

        const pretitle =
            messageArgs.length > 0 ? `${messageArgs.slice(1)} -` : "Evergreen request from";
        const title = `${pretitle} @${requestor} in #${channelName}`.slice(0, 255);

        const body =
            `**@${originalAuthor}**[^1] said in **[#${channelName}](<${messageLink}>)**:\n\n` +
            `${originalText
                .split("\n")
                .map((line) => `> ${line}`)
                .join("\n")}\n\n` +
            `[^1]: @${requestor} please edit this issue to include any additional context or details you think are necessary, ` +
            `and/or assign it to someone else if you would not want to do it.`;

        yield* Effect.logDebug("creating github issue", {
            channel_id: message.channelId,
            assignee_count: assignees.length,
            title_length: title.length,
            body_length: body.length,
        });

        const githubIssueStartTime = Date.now();
        const githubResult = yield* github.createIssue(title, body, assignees).pipe(
            Effect.map((r) => r.html_url),
            Effect.tap((url) =>
                Effect.logInfo("github issue created", {
                    issue_url: url,
                    channel_id: message.channelId,
                    assignee_count: assignees.length,
                    duration_ms: Date.now() - githubIssueStartTime,
                }),
            ),
            Effect.tapError((error) =>
                Effect.logError("failed to create github issue", {
                    channel_id: message.channelId,
                    error_message: error instanceof Error ? error.message : String(error),
                    duration_ms: Date.now() - githubIssueStartTime,
                }),
            ),
            Effect.catchAll(() => Effect.succeed("")),
        );

        const now = new Date();
        const userTitle = messageArgs.length > 0 ? messageArgs.slice(1) : originalText.slice(0, 90);
        const wikiTitle = `in #${channelName} - ${userTitle}`;
        const wikiBody = `\n\n* [${messageLink} @${originalAuthor} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}]: ${wikiTitle}`;

        yield* Effect.logDebug("appending to mediawiki page", {
            channel_id: message.channelId,
            wiki_page: EVERGREEN_WIKI_BUFFER,
            body_length: wikiBody.length,
        });

        const wikiStartTime = Date.now();
        const wikiResult = yield* mediaWiki
            .appendPage(EVERGREEN_WIKI_BUFFER, wikiBody, "Wack Hacker - added issue")
            .pipe(
                Effect.map((r) =>
                    r.success ? `${EVERGREEN_WIKI_URL}/wiki/${EVERGREEN_WIKI_BUFFER}` : "",
                ),
                Effect.tap((url) =>
                    Effect.logInfo("mediawiki page updated", {
                        wiki_url: url,
                        channel_id: message.channelId,
                        wiki_page: EVERGREEN_WIKI_BUFFER,
                        duration_ms: Date.now() - wikiStartTime,
                    }),
                ),
                Effect.tapError((error) =>
                    Effect.logError("failed to update mediawiki page", {
                        channel_id: message.channelId,
                        wiki_page: EVERGREEN_WIKI_BUFFER,
                        error_message: error instanceof Error ? error.message : String(error),
                        duration_ms: Date.now() - wikiStartTime,
                    }),
                ),
                Effect.catchAll(() => Effect.succeed("")),
            );

        yield* Effect.logDebug("sending reply to user", {
            channel_id: message.channelId,
            message_id: message.id,
            github_created: !!githubResult,
            wiki_created: !!wikiResult,
        });

        const replyStart = Date.now();
        yield* Effect.tryPromise({
            try: () =>
                message.reply(
                    `Created [github issue](${githubResult}) and [mediawiki issue](${wikiResult.replaceAll(" ", "_")})!`,
                ),
            catch: (e) =>
                new Error(`Failed to reply: ${e instanceof Error ? e.message : String(e)}`),
        }).pipe(
            Effect.tapError((error) =>
                Effect.logError("failed to send reply", {
                    channel_id: message.channelId,
                    message_id: message.id,
                    error_message: error.message,
                    duration_ms: Date.now() - replyStart,
                }),
            ),
        );

        yield* Effect.logInfo("evergreen request completed", {
            user_id: message.author.id,
            channel_id: message.channelId,
            message_id: message.id,
            original_message_id: original.id,
            original_author_id: original.author.id,
            github_issue_created: !!githubResult,
            wiki_page_updated: !!wikiResult,
            assignee_count: assignees.length,
            duration_ms: Date.now() - startTime,
        });
    },
    Effect.annotateLogs({ feature: "evergreen" }),
);
