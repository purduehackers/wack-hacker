import { DISCORD_GUILD_ID } from "@repo/shared/discord";
import { Routes, type RESTGetAPIGuildScheduledEventResult } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";

export const delete_event = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a scheduled event. This is irreversible and will notify users who have indicated interest.",
  input: z.strictObject({ event_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    const event = discordObject<RESTGetAPIGuildScheduledEventResult>(
      await rest.get(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id)),
      "get guild scheduled event",
    );
    await rest.delete(Routes.guildScheduledEvent(DISCORD_GUILD_ID, input.event_id));
    return { success: true, deleted: event.name ?? input.event_id };
  },
});
