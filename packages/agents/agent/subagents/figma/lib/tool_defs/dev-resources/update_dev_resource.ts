import type { PutDevResourcesRequestBody, PutDevResourcesResponse } from "@figma/rest-api-spec";
import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { figma } from "../../client.ts";

export const update_dev_resource = defineTool({
  description: "Update an existing dev resource's URL or name.",
  access: { risk: "write" },
  input: z.strictObject({
    dev_resource_id: z.string().describe("The dev resource ID to update"),
    url: z.url().exactOptional().describe("New URL"),
    name: z.string().trim().min(1).exactOptional().describe("New display name"),
  }),
  execute: async ({ dev_resource_id, ...changes }) => {
    const entry: PutDevResourcesRequestBody["dev_resources"][number] = {
      id: dev_resource_id,
      ...changes,
    };
    return await figma.put<PutDevResourcesResponse>("/v1/dev_resources", {
      dev_resources: [entry],
    });
  },
});
