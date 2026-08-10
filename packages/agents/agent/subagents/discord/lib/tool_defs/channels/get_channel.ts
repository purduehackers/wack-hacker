import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordRest } from "../../client.ts";
import { channelId, guildChannel, summarizeChannel } from "../../constants.ts";

export const get_channel = defineTool({
  access: { risk: "read" },
  description:
    "Get a single channel's details by ID. Returns type, name, topic, position, parent category, and other settings.",
  input: z.strictObject({ channel_id: channelId }),
  execute: async (input) => summarizeChannel(await guildChannel(discordRest(), input.channel_id)),
});
