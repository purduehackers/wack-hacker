import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const dangerously_delete_edge_cache_by_tags = defineTool({
  description:
    "Forcefully delete (not just invalidate) cache entries by tag. Use invalidate first unless you need storage freed immediately.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    tags: z.array(z.string()).min(1),
  }),
  execute: async ({ project_id_or_name, tags }) => {
    await vercel().edgeCache.dangerouslyDeleteByTags({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { tags },
    });
    return JSON.stringify({ ok: true, deleted: tags });
  },
});
