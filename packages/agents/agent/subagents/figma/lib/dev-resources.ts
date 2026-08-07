import type {
  GetDevResourcesResponse,
  PostDevResourcesRequestBody,
  PostDevResourcesResponse,
  PutDevResourcesRequestBody,
  PutDevResourcesResponse,
} from "@figma/rest-api-spec";
import { z } from "zod";

import { figma } from "./client.ts";
import { defineTool } from "./define-tool.ts";

export const list_dev_resources = defineTool({
  name: "list_dev_resources",
  domain: "figma",
  description:
    "List dev resources (links to code, docs, etc.) attached to nodes in a Figma file. Optionally filter by node ID.",
  access: { risk: "read" },
  input: z.object({
    file_key: z.string().describe("The file key"),
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

export const create_dev_resources = defineTool({
  name: "create_dev_resources",
  domain: "figma",
  description:
    "Attach dev resource links to nodes in a Figma file. Each resource has a URL, name, and target node.",
  access: { risk: "write" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    dev_resources: z
      .array(
        z.object({
          url: z.string().describe("The resource URL"),
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

export const update_dev_resource = defineTool({
  name: "update_dev_resource",
  domain: "figma",
  description: "Update an existing dev resource's URL or name.",
  access: { risk: "write" },
  input: z.object({
    dev_resource_id: z.string().describe("The dev resource ID to update"),
    url: z.string().optional().describe("New URL"),
    name: z.string().optional().describe("New display name"),
  }),
  execute: async ({ dev_resource_id, url, name }) => {
    const entry: PutDevResourcesRequestBody["dev_resources"][number] = { id: dev_resource_id };
    if (url) entry.url = url;
    if (name) entry.name = name;
    return await figma.put<PutDevResourcesResponse>("/v1/dev_resources", {
      dev_resources: [entry],
    });
  },
});

export const delete_dev_resource = defineTool({
  name: "delete_dev_resource",
  domain: "figma",
  description: "Delete a dev resource from a Figma file.",
  access: { risk: "destructive" },
  input: z.object({
    file_key: z.string().describe("The file key"),
    dev_resource_id: z.string().describe("The dev resource ID to delete"),
  }),
  execute: async ({ file_key, dev_resource_id }) => {
    await figma.delete(`/v1/files/${file_key}/dev_resources/${dev_resource_id}`);
    return { deleted: true };
  },
});
