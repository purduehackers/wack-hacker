import type { PostDevResourcesRequestBody, PostDevResourcesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";
import { fileKey } from "../../constants.ts";

export const create_dev_resources = defineTool({
  description:
    "Attach dev resource links to nodes in a Figma file. Each resource has a URL, name, and target node.",
  access: { risk: "write" },
  input: z.strictObject({
    file_key: fileKey,
    dev_resources: z
      .array(
        z.strictObject({
          url: z.url().describe("The resource URL"),
          name: z.string().describe("Display name for the resource"),
          node_id: z.string().describe("Node ID to attach the resource to"),
        }),
      )
      .min(1)
      .describe("Dev resources to create"),
  }),
  execute: async ({ file_key, dev_resources }) => {
    const body: PostDevResourcesRequestBody = {
      dev_resources: dev_resources.map((r) => ({
        ...r,
        file_key,
      })),
    };
    return await figma.post<PostDevResourcesResponse>("/v1/dev_resources", body);
  },
});
