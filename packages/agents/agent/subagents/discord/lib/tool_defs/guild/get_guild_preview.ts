import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildPreviewResult } from "discord-api-types/v10";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { empty } from "../../constants.ts";

export const get_guild_preview = defineTool({
  access: { risk: "read" },
  description:
    "Get public preview info for the Discord server — approximate member count, online count, description, features, and splash image.",
  input: empty,
  execute: async () => {
    const rest = discordRest();
    const preview = discordObject<RESTGetAPIGuildPreviewResult>(
      await rest.get(Routes.guildPreview(DISCORD_GUILD_ID)),
      "get guild preview",
    );
    return {
      id: preview.id,
      name: preview.name,
      description: preview.description ?? null, // oxlint-disable-line unicorn/no-null -- Discord's JSON API uses null for explicit absence
      memberCount: preview.approximate_member_count,
      onlineCount: preview.approximate_presence_count,
      features: Array.isArray(preview.features) ? preview.features : [],
    };
  },
});
