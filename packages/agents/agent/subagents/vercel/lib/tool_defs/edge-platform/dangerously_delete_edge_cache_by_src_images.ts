import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const dangerously_delete_edge_cache_by_src_images = defineTool({
  description: "Forcefully delete image optimizer cache entries for source URLs.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    srcImages: z.array(z.url()).min(1),
  }),
  execute: async ({ project_id_or_name, srcImages }) => {
    await vercel().edgeCache.dangerouslyDeleteBySrcImages({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { srcImages },
    });
    return JSON.stringify({ ok: true, deleted: srcImages });
  },
});
