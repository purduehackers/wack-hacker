import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIGuildScheduledEventsQuery,
  type RESTGetAPIGuildScheduledEventsResult,
} from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordRest } from "../../client.ts";
import { empty, summarizeEvent } from "../../constants.ts";

export const list_events = defineTool({
  access: { risk: "read" },
  description:
    "List all scheduled events in the server. Returns event details including name, description, times, type, location, and attendee count.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    return discordArray<RESTGetAPIGuildScheduledEventsResult>(
      await rest.get(Routes.guildScheduledEvents(DISCORD_GUILD_ID), {
        query: makeURLSearchParams<RESTGetAPIGuildScheduledEventsQuery>({
          with_user_count: true,
        }),
      }),
      "list guild scheduled events",
    ).map(summarizeEvent);
  },
});
