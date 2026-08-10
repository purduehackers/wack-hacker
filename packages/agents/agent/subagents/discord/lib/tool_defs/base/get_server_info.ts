/* oxlint-disable unicorn/no-null -- Discord's JSON API uses null for explicit absence/field clearing. */

import { makeURLSearchParams } from "@discordjs/rest";
import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import {
  Routes,
  type RESTGetAPIGuildQuery,
  type RESTGetAPIGuildResult,
} from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { empty, responseString } from "../../constants.ts";

export const get_server_info = defineTool({
  access: { risk: "read" },
  description:
    "Get Discord server overview: name, member count, channel count, role count, and basic settings. Use this to understand the server at a high level.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    const guild = discordObject<RESTGetAPIGuildResult>(
      await rest.get(Routes.guild(DISCORD_GUILD_ID), {
        query: makeURLSearchParams<RESTGetAPIGuildQuery>({ with_counts: true }),
      }),
      "get guild",
    );
    const icon = responseString.safeParse(guild.icon).data;
    const banner = responseString.safeParse(guild.banner).data;
    return {
      id: guild.id,
      name: guild.name,
      memberCount: guild.approximate_member_count,
      presenceCount: guild.approximate_presence_count,
      ownerId: guild.owner_id,
      description: guild.description ?? null,
      icon:
        icon === undefined
          ? null
          : `https://cdn.discordapp.com/icons/${DISCORD_GUILD_ID}/${icon}.png`,
      banner:
        banner === undefined
          ? null
          : `https://cdn.discordapp.com/banners/${DISCORD_GUILD_ID}/${banner}.png`,
      boostLevel: guild.premium_tier,
      boostCount: guild.premium_subscription_count,
      verificationLevel: guild.verification_level,
      createdAt: guild.id,
    };
  },
});
