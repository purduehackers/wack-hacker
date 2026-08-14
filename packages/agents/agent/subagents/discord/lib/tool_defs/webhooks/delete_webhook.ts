import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { discordSnowflakeSchema } from "../../constants.ts";
import { guildWebhook } from "../../projections.ts";

export const delete_webhook = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a webhook. This is irreversible and will break any integrations using this webhook's URL.",
  input: z.strictObject({ webhook_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    const webhook = await guildWebhook(rest, input.webhook_id);
    await rest.delete(Routes.webhook(input.webhook_id));
    return { success: true, deleted: webhook.name ?? input.webhook_id };
  },
});
