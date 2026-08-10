/**
 * Discord message, reaction and thread operations as ordinary provider calls.
 *
 * These were the last operations to travel over the bot's semantic command RPC.
 * They are plain Discord REST work, so the agent now performs them directly with
 * its own REST identity, exactly like every other domain subagent calls its
 * provider. The routes, request bodies, guild-scope guards, archived-thread
 * pagination and output projections are unchanged from the bot-side executor
 * they were relocated from.
 */
/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { makeURLSearchParams, type REST, type RouteLike } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import {
  ChannelType,
  Routes,
  type APIThreadChannel,
  type RESTGetAPIChannelMessageResult,
  type RESTGetAPIChannelMessagesQuery,
  type RESTGetAPIChannelMessagesResult,
  type RESTGetAPIChannelThreadsArchivedPrivateResult,
  type RESTGetAPIChannelThreadsArchivedPublicResult,
  type RESTGetAPIChannelThreadsArchivedQuery,
  type RESTGetAPIChannelUsersThreadsArchivedResult,
  type RESTGetAPIGuildThreadsResult,
  type RESTPatchAPIChannelJSONBody,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPatchAPIChannelMessageResult,
  type RESTPostAPIChannelFollowersJSONBody,
  type RESTPostAPIChannelFollowersResult,
  type RESTPostAPIChannelMessageCrosspostResult,
  type RESTPostAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessageResult,
  type RESTPostAPIChannelMessagesBulkDeleteJSONBody,
  type RESTPostAPIChannelMessagesThreadsJSONBody,
  type RESTPostAPIChannelThreadsJSONBody,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../lib/policy/domain-tools.ts";
import {
  compact,
  discordArray,
  discordObject,
  discordRest,
  malformedDiscordResponse,
} from "../rest.ts";
import {
  AUTO_ARCHIVE_DURATIONS,
  autoArchiveDuration,
  channelId,
  channelType,
  discordSnowflakeSchema,
  guildChannel,
  responseInt,
  slowmode,
} from "./common.ts";

// ──────────────── input primitives (mirrors of the wire schemas) ────────────────

const messageId = discordSnowflakeSchema.describe("Message ID");

// ──────────────── Discord enum tables ────────────────

/** Only these parent types expose the archived-thread routes. */
const PUBLIC_THREAD_PARENTS = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

// ──────────────── projection helpers ────────────────

type ThreadResult = APIThreadChannel;

function summarizeThread(thread: ThreadResult) {
  const metadata =
    thread.thread_metadata === undefined
      ? undefined
      : discordObject<NonNullable<ThreadResult["thread_metadata"]>>(
          thread.thread_metadata,
          "thread metadata",
        );
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parent_id ?? null,
    archived: metadata?.archived ?? false,
    locked: metadata?.locked ?? false,
    autoArchiveDuration: metadata?.auto_archive_duration ?? null,
    messageCount: thread.message_count ?? 0,
    memberCount: thread.member_count ?? 0,
    createdAt: metadata?.create_timestamp ?? null,
    type: channelType(thread.type),
  };
}

function summarizeMessage(message: RESTGetAPIChannelMessageResult) {
  const author = discordObject<RESTGetAPIChannelMessageResult["author"]>(
    message.author,
    "message author",
  );
  return {
    id: message.id,
    author: author.global_name ?? author.username,
    authorId: author.id,
    isBot: author.bot ?? false,
    content: message.content,
    timestamp: message.timestamp,
    editedTimestamp: message.edited_timestamp ?? null,
    pinned: message.pinned,
    attachments: discordArray<RESTGetAPIChannelMessageResult["attachments"]>(
      message.attachments,
      "message attachments",
    ).map((attachment) => ({
      name: attachment.filename,
      url: attachment.url,
    })),
    embeds: discordArray<RESTGetAPIChannelMessageResult["embeds"]>(message.embeds, "message embeds")
      .length,
  };
}

// ──────────────── archived thread pagination ────────────────

const ARCHIVED_THREAD_PAGE_LIMIT = 100;
const MAX_ARCHIVED_THREAD_PAGES = 100;
const archiveTimestampCursorSchema = z.iso.datetime({ offset: true });
type ArchiveCursorKind = "archive-timestamp" | "thread-snowflake";

/** Each archived-thread route pages on its own cursor, which must strictly advance. */
function nextArchiveCursor(
  thread: ThreadResult,
  kind: ArchiveCursorKind,
  previous: string | undefined,
  endpoint: string,
): string {
  if (kind === "thread-snowflake") {
    const parsed = discordSnowflakeSchema.safeParse(thread.id);
    if (!parsed.success || (previous !== undefined && BigInt(parsed.data) >= BigInt(previous))) {
      throw malformedDiscordResponse(`${endpoint} pagination cursor`);
    }
    return parsed.data;
  }

  const metadata = discordObject<NonNullable<ThreadResult["thread_metadata"]>>(
    thread.thread_metadata,
    `${endpoint} thread metadata`,
  );
  const parsed = archiveTimestampCursorSchema.safeParse(metadata.archive_timestamp);
  if (
    !parsed.success ||
    (previous !== undefined && Date.parse(parsed.data) >= Date.parse(previous))
  ) {
    throw malformedDiscordResponse(`${endpoint} pagination cursor`);
  }
  return parsed.data;
}

async function archivedThreadPages<ResultType extends RESTGetAPIChannelUsersThreadsArchivedResult>(
  rest: REST,
  route: RouteLike,
  endpoint: string,
  cursorKind: ArchiveCursorKind,
): Promise<ThreadResult[]> {
  const found: ThreadResult[] = [];
  let before: string | undefined;
  for (let pageNumber = 0; pageNumber < MAX_ARCHIVED_THREAD_PAGES; pageNumber += 1) {
    const page = discordObject<ResultType>(
      await rest.get(route, {
        query: makeURLSearchParams<RESTGetAPIChannelThreadsArchivedQuery>({
          limit: ARCHIVED_THREAD_PAGE_LIMIT,
          ...(before === undefined ? {} : { before }),
        }),
      }),
      endpoint,
    );
    const hasMore = z.boolean().safeParse(page.has_more);
    if (!hasMore.success) throw malformedDiscordResponse(endpoint);
    const threads = discordArray<ResultType["threads"]>(page.threads, endpoint).map((candidate) =>
      discordObject<ThreadResult>(candidate, endpoint),
    );
    found.push(...threads);
    if (!hasMore.data) return found;
    const lastThread = threads.at(-1);
    if (lastThread === undefined) throw malformedDiscordResponse(`${endpoint} pagination cursor`);
    before = nextArchiveCursor(lastThread, cursorKind, before, endpoint);
  }
  throw malformedDiscordResponse(`${endpoint} pagination did not terminate`);
}

// ──────────────── operations ────────────────

export const MESSAGE_OPERATIONS = {
  follow_announcement_channel: defineTool({
    access: { risk: "destructive" },
    description:
      "Follow an announcement channel — its messages will be auto-crossposted to the target channel in this server. Only announcement channels can be followed.",
    input: z.strictObject({
      source_channel_id: channelId,
      target_channel_id: channelId,
    }),
    execute: async (input) => {
      const rest = discordRest();
      await Promise.all([
        guildChannel(rest, input.source_channel_id),
        guildChannel(rest, input.target_channel_id),
      ]);
      const followed = discordObject<RESTPostAPIChannelFollowersResult>(
        await rest.post(Routes.channelFollowers(input.source_channel_id), {
          body: {
            webhook_channel_id: input.target_channel_id,
          } satisfies RESTPostAPIChannelFollowersJSONBody,
        }),
        "follow announcement channel",
      );
      return {
        followed: true,
        source: input.source_channel_id,
        target: followed.channel_id,
        webhook_id: followed.webhook_id,
      };
    },
  }),

  send_message: defineTool({
    access: { risk: "destructive" },
    description:
      "Send a message to a channel. Supports Discord markdown formatting. Returns the sent message's ID, channel ID, and content.",
    input: z.strictObject({
      channel_id: channelId,
      content: z.string().min(1).max(2_000),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPostAPIChannelMessageResult>(
        await rest.post(Routes.channelMessages(input.channel_id), {
          body: { content: input.content } satisfies RESTPostAPIChannelMessageJSONBody,
        }),
        "send channel message",
      );
      return { id: message.id, channelId: message.channel_id, content: message.content };
    },
  }),

  delete_message: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a message from a channel. Requires the message ID and channel ID. This is irreversible.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelMessage(input.channel_id, input.message_id));
      return { success: true, deleted: input.message_id };
    },
  }),

  pin_message: defineTool({
    access: { risk: "write" },
    description:
      "Pin a message in a channel. Pinned messages appear in the channel's pinned messages panel for easy reference.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.put(Routes.channelPin(input.channel_id, input.message_id));
      return { success: true, pinned: input.message_id };
    },
  }),

  unpin_message: defineTool({
    access: { risk: "write", confirm: "self" },
    description:
      "Unpin a message in a channel. Removes the message from the channel's pinned messages panel.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelPin(input.channel_id, input.message_id));
      return { success: true, unpinned: input.message_id };
    },
  }),

  add_reaction: defineTool({
    access: { risk: "write" },
    description:
      "Add a reaction emoji to a message. Use Unicode emoji characters (e.g. '\u{1F44D}') or custom emoji in the format 'name:id' (e.g. 'custom_emoji:123456789').",
    input: z.strictObject({
      channel_id: channelId,
      message_id: messageId,
      emoji: z.string().trim().min(1).max(100),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.put(
        Routes.channelMessageOwnReaction(
          input.channel_id,
          input.message_id,
          encodeURIComponent(input.emoji),
        ),
      );
      return { success: true, reacted: input.emoji };
    },
  }),

  get_message: defineTool({
    access: { risk: "read" },
    description:
      "Get a single message by channel ID and message ID. Returns the message content, author, timestamps, attachments, embeds, and pin status.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      return summarizeMessage(
        discordObject<RESTGetAPIChannelMessageResult>(
          await rest.get(Routes.channelMessage(input.channel_id, input.message_id)),
          "get channel message",
        ),
      );
    },
  }),

  edit_message: defineTool({
    access: { risk: "destructive" },
    description:
      "Edit a message the bot sent. Only the bot's own messages can be edited. Replaces the content entirely.",
    input: z.strictObject({
      channel_id: channelId,
      message_id: messageId,
      content: z.string().min(1).max(2_000),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPatchAPIChannelMessageResult>(
        await rest.patch(Routes.channelMessage(input.channel_id, input.message_id), {
          body: { content: input.content } satisfies RESTPatchAPIChannelMessageJSONBody,
        }),
        "edit channel message",
      );
      return { id: message.id, content: message.content };
    },
  }),

  bulk_delete_messages: defineTool({
    access: { risk: "destructive" },
    description:
      "Bulk delete 2-100 messages from a channel in a single call. Messages must be less than 14 days old. Irreversible.",
    input: z.strictObject({
      channel_id: channelId,
      message_ids: z.array(messageId).min(2).max(100),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.post(Routes.channelBulkDelete(input.channel_id), {
        body: {
          messages: input.message_ids,
        } satisfies RESTPostAPIChannelMessagesBulkDeleteJSONBody,
      });
      return { deleted: input.message_ids.length, message_ids: input.message_ids };
    },
  }),

  crosspost_message: defineTool({
    access: { risk: "destructive" },
    description:
      "Publish (crosspost) a message in an announcement channel so it's sent to following channels.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const message = discordObject<RESTPostAPIChannelMessageCrosspostResult>(
        await rest.post(Routes.channelMessageCrosspost(input.channel_id, input.message_id)),
        "crosspost channel message",
      );
      return { id: message.id, crossposted: true };
    },
  }),

  remove_reaction: defineTool({
    access: { risk: "destructive" },
    description:
      "Remove a specific user's reaction from a message. Pass '@me' for the bot's own reaction.",
    input: z.strictObject({
      channel_id: channelId,
      message_id: messageId,
      emoji: z.string().trim().min(1).max(100),
      user_id: z.union([discordSnowflakeSchema, z.literal("@me")]),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const emoji = encodeURIComponent(input.emoji);
      const route =
        input.user_id === "@me"
          ? Routes.channelMessageOwnReaction(input.channel_id, input.message_id, emoji)
          : Routes.channelMessageUserReaction(
              input.channel_id,
              input.message_id,
              emoji,
              input.user_id,
            );
      await rest.delete(route);
      return { removed: true };
    },
  }),

  remove_all_reactions: defineTool({
    access: { risk: "destructive" },
    description: "Remove every reaction from a message. Irreversible.",
    input: z.strictObject({ channel_id: channelId, message_id: messageId }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      await rest.delete(Routes.channelMessageAllReactions(input.channel_id, input.message_id));
      return { cleared: true };
    },
  }),

  fetch_messages: defineTool({
    access: { risk: "read" },
    description:
      "Fetch recent messages from a channel. Returns messages sorted oldest-first with author info, content, timestamps, attachments, and pin status. Supports pagination via before/after message IDs.",
    input: z.strictObject({
      channel_id: channelId,
      limit: z.int().min(1).max(100).default(25),
      before: discordSnowflakeSchema.optional(),
      after: discordSnowflakeSchema.optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const fetchedMessages = discordArray<RESTGetAPIChannelMessagesResult>(
        await rest.get(Routes.channelMessages(input.channel_id), {
          query: makeURLSearchParams<RESTGetAPIChannelMessagesQuery>({
            limit: input.limit,
            ...(input.before === undefined ? {} : { before: input.before }),
            ...(input.after === undefined ? {} : { after: input.after }),
          }),
        }),
        "fetch channel messages",
      );
      return [...fetchedMessages]
        .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
        .map(summarizeMessage);
    },
  }),

  list_threads: defineTool({
    access: { risk: "read" },
    description:
      "List active threads in the server or archived threads in a specific channel. Use channel_id with include_archived to get archived threads from a particular channel.",
    input: z
      .strictObject({
        channel_id: channelId.optional(),
        include_archived: z.boolean().default(false),
      })
      .superRefine((value, ctx) => {
        if (value.include_archived && value.channel_id === undefined) {
          ctx.addIssue({
            code: "custom",
            path: ["channel_id"],
            message: "include_archived requires channel_id",
          });
        }
      }),
    execute: async (input) => {
      const rest = discordRest();
      const active = discordObject<RESTGetAPIGuildThreadsResult>(
        await rest.get(Routes.guildActiveThreads(DISCORD_GUILD_ID)),
        "list active guild threads",
      );
      const foundThreads = new Map<string, ThreadResult>();
      for (const thread of discordArray<RESTGetAPIGuildThreadsResult["threads"]>(
        active.threads,
        "list active guild threads",
      )) {
        const checkedThread = discordObject<ThreadResult>(thread, "list active guild threads");
        if (input.channel_id === undefined || checkedThread.parent_id === input.channel_id) {
          foundThreads.set(checkedThread.id, checkedThread);
        }
      }
      if (input.channel_id === undefined) return [...foundThreads.values()].map(summarizeThread);

      const parent = await guildChannel(rest, input.channel_id);
      if (!input.include_archived) return [...foundThreads.values()].map(summarizeThread);
      const parentType = responseInt.safeParse(parent.type);
      if (!parentType.success) throw malformedDiscordResponse("get thread parent channel");
      if (!PUBLIC_THREAD_PARENTS.has(parentType.data)) {
        throw new UpstreamError({
          service: "Discord",
          status: 400,
          detail: "channel type does not support archived threads",
        });
      }

      const publicEndpoint = "list public archived channel threads";
      for (const thread of await archivedThreadPages<RESTGetAPIChannelThreadsArchivedPublicResult>(
        rest,
        Routes.channelThreads(input.channel_id, "public"),
        publicEndpoint,
        "archive-timestamp",
      )) {
        foundThreads.set(thread.id, thread);
      }
      if (parent.type === ChannelType.GuildText) {
        const privateEndpoint = "list private archived channel threads";
        for (const thread of await archivedThreadPages<RESTGetAPIChannelThreadsArchivedPrivateResult>(
          rest,
          Routes.channelThreads(input.channel_id, "private"),
          privateEndpoint,
          "archive-timestamp",
        )) {
          foundThreads.set(thread.id, thread);
        }
        const joinedEndpoint = "list joined private archived channel threads";
        for (const thread of await archivedThreadPages<RESTGetAPIChannelUsersThreadsArchivedResult>(
          rest,
          Routes.channelJoinedArchivedThreads(input.channel_id),
          joinedEndpoint,
          "thread-snowflake",
        )) {
          foundThreads.set(thread.id, thread);
        }
      }
      return [...foundThreads.values()].map(summarizeThread);
    },
  }),

  create_thread: defineTool({
    access: { risk: "write" },
    description:
      "Create a new thread in a channel. Can be a standalone thread or start from an existing message. Supports public and private thread types.",
    input: z.strictObject({
      channel_id: channelId,
      name: z.string().trim().min(1).max(100),
      message_id: messageId.optional(),
      auto_archive_duration: autoArchiveDuration.optional(),
      type: z.enum(["public", "private"]).default("public"),
      slowmode: slowmode.optional(),
      invitable: z.boolean().optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.channel_id);
      const body = compact<
        RESTPostAPIChannelThreadsJSONBody | RESTPostAPIChannelMessagesThreadsJSONBody
      >({
        name: input.name,
        auto_archive_duration:
          input.auto_archive_duration === undefined
            ? undefined
            : AUTO_ARCHIVE_DURATIONS[input.auto_archive_duration],
        rate_limit_per_user: input.slowmode,
        type:
          input.message_id === undefined
            ? input.type === "private"
              ? ChannelType.PrivateThread
              : ChannelType.PublicThread
            : undefined,
        invitable:
          input.message_id === undefined && input.type === "private" ? input.invitable : undefined,
      });
      const path = Routes.threads(input.channel_id, input.message_id);
      return summarizeThread(
        discordObject<ThreadResult>(await rest.post(path, { body }), "create channel thread"),
      );
    },
  }),

  edit_thread: defineTool({
    access: { risk: "write" },
    description:
      "Edit a thread's settings including name, archived/locked state, auto-archive duration, slowmode, and invitability.",
    input: z.strictObject({
      thread_id: discordSnowflakeSchema,
      name: z.string().trim().min(1).max(100).optional(),
      archived: z.boolean().optional(),
      locked: z.boolean().optional(),
      auto_archive_duration: autoArchiveDuration.optional(),
      slowmode: slowmode.optional(),
      invitable: z.boolean().optional(),
    }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.thread_id);
      return summarizeThread(
        discordObject<ThreadResult>(
          await rest.patch(Routes.channel(input.thread_id), {
            body: compact<RESTPatchAPIChannelJSONBody>({
              name: input.name,
              archived: input.archived,
              locked: input.locked,
              auto_archive_duration:
                input.auto_archive_duration === undefined
                  ? undefined
                  : AUTO_ARCHIVE_DURATIONS[input.auto_archive_duration],
              rate_limit_per_user: input.slowmode,
              invitable: input.invitable,
            }),
          }),
          "edit channel thread",
        ),
      );
    },
  }),

  delete_thread: defineTool({
    access: { risk: "destructive" },
    description:
      "Delete a thread. This is irreversible and will permanently remove the thread and all its messages.",
    input: z.strictObject({ thread_id: discordSnowflakeSchema }),
    execute: async (input) => {
      const rest = discordRest();
      await guildChannel(rest, input.thread_id);
      const thread = discordObject<ThreadResult>(
        await rest.delete(Routes.channel(input.thread_id)),
        "delete thread",
      );
      return { success: true, deleted: thread.name ?? input.thread_id };
    },
  }),
} as const;
