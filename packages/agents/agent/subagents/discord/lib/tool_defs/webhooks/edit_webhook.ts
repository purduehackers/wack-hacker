import {
  Routes,
  type RESTPatchAPIWebhookJSONBody,
  type RESTPatchAPIWebhookResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import { channelId, discordSnowflakeSchema, httpUrl } from "../../constants.ts";
import { guildChannel, guildWebhook, imageDataUri, summarizeWebhook } from "../../projections.ts";

export const edit_webhook = defineTool({
  access: { risk: "destructive" },
  description: "Edit a webhook's name, avatar, or move it to a different channel.",
  input: z.strictObject({
    webhook_id: discordSnowflakeSchema,
    name: z.string().trim().min(1).max(80).optional(),
    avatar: httpUrl.optional(),
    channel_id: channelId.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildWebhook(rest, input.webhook_id);
    if (input.channel_id !== undefined) await guildChannel(rest, input.channel_id);
    const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
    return summarizeWebhook(
      discordObject<RESTPatchAPIWebhookResult>(
        await rest.patch(Routes.webhook(input.webhook_id), {
          body: compact<RESTPatchAPIWebhookJSONBody>({
            name: input.name,
            avatar,
            channel_id: input.channel_id,
          }),
        }),
        "edit webhook",
      ),
    );
  },
});
