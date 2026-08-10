import type { GetDevResourcesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const list_dev_resources = defineTool({
  description:
    "List dev resources (links to code, docs, etc.) attached to nodes in a Figma file. Optionally filter by node ID.",
  access: { risk: "read" },
  input: z.strictObject({
    file_key: fileKey,
    node_ids: z.array(z.string()).optional().describe("Filter to specific node IDs"),
  }),
  execute: async ({ file_key, node_ids }) => {
    const search = new URLSearchParams();
    if (node_ids?.length) search.set("node_ids", node_ids.join(","));
    const qs = search.toString();
    const data = await figma.get<GetDevResourcesResponse>(
      `/v1/files/${file_key}/dev_resources${qs ? `?${qs}` : ""}`,
    );
    return data.dev_resources;
  },
});
