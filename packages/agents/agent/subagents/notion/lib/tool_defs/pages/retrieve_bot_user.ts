import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const retrieve_bot_user = defineTool({
  description:
    "Get info about the bot user backing this integration — useful for confirming which workspace and user the integration is acting as.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const me = await notion.users.me({});
    return {
      id: me.id,
      name: me.name,
      type: me.type,
      workspace_name: me.type === "bot" ? me.bot.workspace_name : undefined,
    };
  },
});
