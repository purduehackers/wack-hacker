import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const delete_block = defineTool({
  description:
    "Archive (soft-delete) a block. Notion does not permanently delete blocks — this sets archived=true.",
  access: { risk: "destructive" },
  input: z.strictObject({
    block_id: z.string().describe("Block UUID"),
  }),
  execute: async ({ block_id }) => {
    const block = await notion.blocks.delete({ block_id });
    return {
      id: block.id,
      archived: "archived" in block ? block.archived : true,
    };
  },
});
