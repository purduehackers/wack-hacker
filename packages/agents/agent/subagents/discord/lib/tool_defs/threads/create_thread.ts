import {
  ChannelType,
  Routes,
  type RESTPostAPIChannelMessagesThreadsJSONBody,
  type RESTPostAPIChannelThreadsJSONBody,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  autoArchiveDuration,
  AUTO_ARCHIVE_DURATIONS,
  channelId,
  messageId,
  slowmode,
} from "../../constants.ts";
import { guildChannel, summarizeThread, type ThreadResult } from "../../projections.ts";

export const create_thread = defineTool({
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
});
