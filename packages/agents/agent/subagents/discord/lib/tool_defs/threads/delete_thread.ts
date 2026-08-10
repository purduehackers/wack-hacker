import { Routes } from "discord-api-types/v10";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { discordObject, discordRest } from "../../client.ts";
import { discordSnowflakeSchema, guildChannel, type ThreadResult } from "../../constants.ts";

export const delete_thread = defineTool({
  access: { risk: "destructive" },
  description:
    "Delete a thread. This is irreversible and will permanently remove the thread and all its messages.",
  input: z.strictObject({ thread_id: discordSnowflakeSchema }),
  execute: async (input) => {
    const rest = discordRest();
    await guildChannel(rest, input.thread_id);
    const thread = discordObject<ThreadResult>(
      await rest.delete(Routes.channel(input.thread_id)),
      "delete thread",
    );
    return { success: true, deleted: thread.name ?? input.thread_id };
  },
});
