import {
  Routes,
  type RESTPostAPIChannelWebhookJSONBody,
  type RESTPostAPIChannelWebhookResult,
} from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { compact, discordObject, discordRest } from "../../client.ts";
import {
  channelId,
  guildChannel,
  httpUrl,
  imageDataUri,
  summarizeWebhook,
} from "../../constants.ts";

export const create_webhook = defineTool({
  access: { risk: "destructive" },
  description:
    "Create a webhook in a channel. Returns its non-secret ID, name, and channel; the webhook token and URL are never exposed.",
  input: z.strictObject({
    channel_id: channelId,
    name: z.string().trim().min(1).max(80),
    avatar: httpUrl.optional(),
  }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.channel_id);
    const avatar = input.avatar === undefined ? undefined : await imageDataUri(input.avatar);
    return summarizeWebhook(
      discordObject<RESTPostAPIChannelWebhookResult>(
        await rest.post(Routes.channelWebhooks(input.channel_id), {
          body: compact<RESTPostAPIChannelWebhookJSONBody>({ name: input.name, avatar }),
        }),
        "create channel webhook",
      ),
    );
  },
});
