import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const get_file_nodes = defineTool({
  description:
    "Get specific nodes from a Figma file by their IDs. Returns the full node subtree with properties. Use get_file first to discover node IDs.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
    node_ids: z.array(z.string()).min(1).describe('Node IDs to retrieve (e.g., ["1:2", "3:456"])'),
    depth: z.int().min(1).max(4).optional().describe("How deep to traverse each node subtree"),
  }),
  execute: async ({ file_key, node_ids, depth }) => {
    const params = new URLSearchParams({ ids: node_ids.join(",") });
    if (depth) params.set("depth", String(depth));
    const data = await figma.get<GetFileNodesResponse>(
      `/v1/files/${file_key}/nodes?${params.toString()}`,
    );
    return data.nodes;
  },
});
