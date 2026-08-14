import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { httpStatusOf } from "@repo/shared/errors";
import {
  Routes,
  type RESTGetAPIGuildMemberResult,
  type RESTGetAPIGuildMembersSearchQuery,
  type RESTGetAPIGuildMembersSearchResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";
import { summarizeMember } from "../../projections.ts";

export const search_members = defineTool({
  access: { risk: "read" },
  description:
    "Search for server members by name, nickname, or user ID. Returns member info including roles, join date, and display name. Use this to find a user before performing member operations.",
  input: z.strictObject({
    query: z.string().trim().min(1).max(100),
    limit: z.int().min(1).max(100).default(10),
  }),
  execute: async (input) => {
    const rest = discordRest();
    if (discordSnowflakeSchema.safeParse(input.query).success) {
      try {
        return [
          summarizeMember(
            discordObject<RESTGetAPIGuildMemberResult>(
              await rest.get(Routes.guildMember(DISCORD_GUILD_ID, input.query)),
              "get guild member",
            ),
          ),
        ];
      } catch (cause) {
        if (httpStatusOf(cause) === 404) return [];
        throw cause;
      }
    }
    return discordArray<RESTGetAPIGuildMembersSearchResult>(
      await rest.get(Routes.guildMembersSearch(DISCORD_GUILD_ID), {
        query: makeURLSearchParams<RESTGetAPIGuildMembersSearchQuery>({
          query: input.query,
          limit: input.limit,
        }),
      }),
      "search guild members",
    ).map(summarizeMember);
  },
});
