import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIGuildBansQuery,
  type RESTGetAPIGuildBansResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordArray, discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";

export const list_bans = defineTool({
  access: { risk: "read", minRole: "admin" },
  description:
    "List banned users in the Discord server. Returns user ID, username, and ban reason. Paginated via before/after cursors (snowflake IDs).",
  input: z.strictObject({
    limit: z.int().min(1).max(1_000).optional(),
    before: discordSnowflakeSchema.optional(),
    after: discordSnowflakeSchema.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    return discordArray<RESTGetAPIGuildBansResult>(
      await rest.get(Routes.guildBans(DISCORD_GUILD_ID), {
        query: makeURLSearchParams<RESTGetAPIGuildBansQuery>({
          limit: input.limit ?? 100,
          ...(input.before !== undefined && { before: input.before }),
          ...(input.after !== undefined && { after: input.after }),
        }),
      }),
      "list guild bans",
    ).map((ban) => {
      const user = discordObject<RESTGetAPIGuildBansResult[number]["user"]>(
        ban.user,
        "guild ban user",
      );
      return {
        userId: user.id,
        username: user.global_name ?? user.username,
        reason: ban.reason ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
      };
    });
  },
});
