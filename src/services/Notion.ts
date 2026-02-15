import { Client } from "@notionhq/client";
import { Duration, Effect } from "effect";

import { AppConfig } from "../config";
import { MEETING_NOTES_DATABASE_ID, MEETING_NOTES_DEFAULT_DIRECTORY } from "../constants";
import { NotionError } from "../errors";

export interface NotionMeetingSection {
    heading: string;
    content: string;
}

export interface CreateMeetingEntryInput {
    title: string;
    guildId: string;
    voiceChannelId: string;
    transcriptThreadId: string;
    startedAt: Date;
    endedAt: Date;
    endedReason: "manual" | "auto_empty";
}

const NOTION_RICH_TEXT_LIMIT = 1_900;
const NOTION_BLOCK_APPEND_BATCH_SIZE = 100;

const chunkText = (text: string, maxLength = NOTION_RICH_TEXT_LIMIT): string[] => {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];
    let offset = 0;

    while (offset < text.length) {
        chunks.push(text.slice(offset, offset + maxLength));
        offset += maxLength;
    }

    return chunks;
};

const chunkArray = <T>(items: readonly T[], chunkSize: number): T[][] => {
    if (items.length === 0) {
        return [];
    }

    const chunks: T[][] = [];

    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }

    return chunks;
};

const paragraphBlock = (content: string) => ({
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: {
        rich_text: [
            {
                type: "text" as const,
                text: {
                    content,
                },
            },
        ],
    },
});

const headingBlock = (content: string) => ({
    object: "block" as const,
    type: "heading_2" as const,
    heading_2: {
        rich_text: [
            {
                type: "text" as const,
                text: {
                    content,
                },
            },
        ],
    },
});

export class Notion extends Effect.Service<Notion>()("Notion", {
    dependencies: [AppConfig.Default],
    scoped: Effect.gen(function* () {
        const config = yield* AppConfig;
        const notion = new Client({
            auth: config.NOTION_API_KEY.length > 0 ? config.NOTION_API_KEY : undefined,
        });

        const getTitlePropertyName = Effect.fn("Notion.getTitlePropertyName")(function* () {
            if (!MEETING_NOTES_DATABASE_ID) {
                return yield* Effect.fail(
                    new NotionError({
                        operation: "getTitlePropertyName",
                        cause: new Error(
                            "MEETING_NOTES_DATABASE_ID is empty. Set it in src/constants.ts.",
                        ),
                    }),
                );
            }

            if (config.NOTION_API_KEY.length === 0) {
                return yield* Effect.fail(
                    new NotionError({
                        operation: "getTitlePropertyName",
                        cause: new Error(
                            "NOTION_API_KEY is empty. Set NOTION_API_KEY to enable meeting notes finalization.",
                        ),
                    }),
                );
            }

            const database = yield* Effect.tryPromise({
                try: () => notion.databases.retrieve({ database_id: MEETING_NOTES_DATABASE_ID }),
                catch: (cause) =>
                    new NotionError({ operation: "retrieveDatabase", cause }),
            });

            const databaseProperties =
                "properties" in database && database.properties && typeof database.properties === "object"
                    ? database.properties
                    : null;

            if (!databaseProperties) {
                return yield* Effect.fail(
                    new NotionError({
                        operation: "resolveTitleProperty",
                        cause: new Error("Notion database response did not include properties."),
                    }),
                );
            }

            const titlePropertyName = Object.entries(databaseProperties).find(([, property]) => {
                if (!property || typeof property !== "object") {
                    return false;
                }

                return "type" in property && property.type === "title";
            })?.[0];

            if (!titlePropertyName) {
                return yield* Effect.fail(
                    new NotionError({
                        operation: "resolveTitleProperty",
                        cause: new Error("No title property found on Notion meeting notes database."),
                    }),
                );
            }

            return titlePropertyName;
        });

        const createMeetingEntry = Effect.fn("Notion.createMeetingEntry")(function* (
            input: CreateMeetingEntryInput,
        ) {
            const titlePropertyName = yield* getTitlePropertyName();

            yield* Effect.annotateCurrentSpan({
                title: input.title,
                guild_id: input.guildId,
                voice_channel_id: input.voiceChannelId,
                transcript_thread_id: input.transcriptThreadId,
                notion_database_id: MEETING_NOTES_DATABASE_ID,
            });

            const [duration, page] = yield* Effect.tryPromise({
                try: () =>
                    notion.pages.create({
                        parent: {
                            database_id: MEETING_NOTES_DATABASE_ID,
                        },
                        properties: {
                            [titlePropertyName]: {
                                title: [
                                    {
                                        type: "text",
                                        text: {
                                            content: input.title,
                                        },
                                    },
                                ],
                            },
                        },
                    }),
                catch: (cause) =>
                    new NotionError({ operation: "createMeetingEntry", cause }),
            }).pipe(Effect.timed);

            const durationMs = Duration.toMillis(duration);
            const pageUrl =
                "url" in page && typeof page.url === "string" ? page.url : "";

            yield* Effect.logInfo("notion meeting entry created", {
                service_name: "Notion",
                method: "createMeetingEntry",
                operation_type: "create_page",
                page_id: page.id,
                page_url: pageUrl,
                notion_database_id: MEETING_NOTES_DATABASE_ID,
                title: input.title,
                guild_id: input.guildId,
                voice_channel_id: input.voiceChannelId,
                transcript_thread_id: input.transcriptThreadId,
                duration_ms: durationMs,
            });

            const metadataSections: NotionMeetingSection[] = [
                {
                    heading: "Meeting Metadata",
                    content: [
                        `directory: ${MEETING_NOTES_DEFAULT_DIRECTORY}`,
                        `guild_id: ${input.guildId}`,
                        `voice_channel_id: ${input.voiceChannelId}`,
                        `transcript_thread_id: ${input.transcriptThreadId}`,
                        `started_at: ${input.startedAt.toISOString()}`,
                        `ended_at: ${input.endedAt.toISOString()}`,
                        `ended_reason: ${input.endedReason}`,
                    ].join("\n"),
                },
            ];

            yield* appendSections(page.id, metadataSections);

            return {
                pageId: page.id,
                pageUrl,
            };
        });

        const appendSections = Effect.fn("Notion.appendSections")(function* (
            pageId: string,
            sections: ReadonlyArray<NotionMeetingSection>,
        ) {
            const blocks: Array<Record<string, unknown>> = [];

            for (const section of sections) {
                blocks.push(headingBlock(section.heading) as Record<string, unknown>);

                const sectionContent = section.content.trim().length > 0 ? section.content : "(empty)";
                const contentChunks = chunkText(sectionContent);

                for (const contentChunk of contentChunks) {
                    blocks.push(paragraphBlock(contentChunk) as Record<string, unknown>);
                }
            }

            const batches = chunkArray(blocks, NOTION_BLOCK_APPEND_BATCH_SIZE);

            const [duration] = yield* Effect.forEach(
                batches,
                (batch) =>
                    Effect.tryPromise({
                        try: () =>
                            notion.blocks.children.append({
                                block_id: pageId,
                                children: batch as any,
                            }),
                        catch: (cause) => new NotionError({ operation: "appendSections", cause }),
                    }),
                { concurrency: 1 },
            ).pipe(Effect.timed);

            const durationMs = Duration.toMillis(duration);

            yield* Effect.logInfo("notion sections appended", {
                service_name: "Notion",
                method: "appendSections",
                operation_type: "append_blocks",
                page_id: pageId,
                section_count: sections.length,
                blocks_count: blocks.length,
                batches_count: batches.length,
                duration_ms: durationMs,
            });
        });

        return { createMeetingEntry, appendSections } as const;
    }).pipe(Effect.annotateLogs({ service: "Notion" })),
}) {}
