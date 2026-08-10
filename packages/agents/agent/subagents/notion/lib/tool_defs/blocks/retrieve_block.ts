import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const retrieve_block = defineTool({
  description:
    "Get a single Notion block by ID. Returns block type and its typed content. Use for inspecting individual blocks before updating.",
  access: { risk: "read" },
  input: z.strictObject({
    block_id: z.string().describe("Block UUID"),
  }),
  execute: async ({ block_id }) => {
    return await notion.blocks.retrieve({ block_id });
  },
});
