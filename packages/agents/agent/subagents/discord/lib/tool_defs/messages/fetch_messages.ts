import { makeURLSearchParams } from "@discordjs/rest";
import {
  Routes,
  type RESTGetAPIChannelMessagesQuery,
  type RESTGetAPIChannelMessagesResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { channelId, discordSnowflakeSchema } from "../../constants.ts";
import { guildChannel, summarizeMessage } from "../../projections.ts";

export const fetch_messages = defineTool({
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
          ...(input.before !== undefined && { before: input.before }),
          ...(input.after !== undefined && { after: input.after }),
        }),
      }),
      "fetch channel messages",
    );
    return [...fetchedMessages]
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .map(summarizeMessage);
  },
});
