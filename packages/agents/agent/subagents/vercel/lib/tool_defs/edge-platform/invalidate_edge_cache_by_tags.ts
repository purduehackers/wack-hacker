import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const invalidate_edge_cache_by_tags = defineTool({
  description: "Invalidate Vercel Edge Cache entries tagged with any of the given tags.",
  access: { risk: "write" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    tags: z.array(z.string()).min(1),
  }),
  execute: async ({ project_id_or_name, tags }) => {
    await vercel().edgeCache.invalidateByTags({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { tags },
    });
    return JSON.stringify({ ok: true, invalidated: tags });
  },
});
