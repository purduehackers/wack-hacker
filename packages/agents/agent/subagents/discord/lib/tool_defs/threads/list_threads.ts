import type { REST } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { UpstreamError } from "@repo/shared/errors";
import {
  ChannelType,
  Routes,
  type RESTGetAPIChannelThreadsArchivedPrivateResult,
  type RESTGetAPIChannelThreadsArchivedPublicResult,
  type RESTGetAPIChannelUsersThreadsArchivedResult,
  type RESTGetAPIGuildThreadsResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { archivedThreadPages } from "../../archived-threads.ts";
import {
  discordArray,
  discordObject,
  discordRest,
  malformedDiscordResponse,
} from "../../client.ts";
import {
  channelId,
  guildChannel,
  responseInt,
  summarizeThread,
  type ThreadResult,
} from "../../constants.ts";

/** Only these parent types expose the archived-thread routes. */
const PUBLIC_THREAD_PARENTS = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);

/**
 * A text channel's archived threads live behind three separate routes. Only a
 * text channel exposes the private and joined-private ones.
 */
async function archivedThreadsOf(
  rest: REST,
  parentChannelId: string,
  parentType: number,
): Promise<ThreadResult[]> {
  const found = await archivedThreadPages<RESTGetAPIChannelThreadsArchivedPublicResult>(
    rest,
    Routes.channelThreads(parentChannelId, "public"),
    "list public archived channel threads",
    "archive-timestamp",
  );
  if (parentType !== ChannelType.GuildText) return found;
  found.push(
    ...(await archivedThreadPages<RESTGetAPIChannelThreadsArchivedPrivateResult>(
      rest,
      Routes.channelThreads(parentChannelId, "private"),
      "list private archived channel threads",
      "archive-timestamp",
    )),
    ...(await archivedThreadPages<RESTGetAPIChannelUsersThreadsArchivedResult>(
      rest,
      Routes.channelJoinedArchivedThreads(parentChannelId),
      "list joined private archived channel threads",
      "thread-snowflake",
    )),
  );
  return found;
}

export const list_threads = defineTool({
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

    for (const thread of await archivedThreadsOf(rest, input.channel_id, parentType.data)) {
      foundThreads.set(thread.id, thread);
    }
    return [...foundThreads.values()].map(summarizeThread);
  },
});
