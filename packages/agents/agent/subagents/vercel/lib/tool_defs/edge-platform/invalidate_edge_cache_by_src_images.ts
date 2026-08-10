import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const invalidate_edge_cache_by_src_images = defineTool({
  description: "Invalidate the image optimizer cache for specific source image URLs.",
  access: { risk: "write" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    srcImages: z.array(z.url()).min(1),
  }),
  execute: async ({ project_id_or_name, srcImages }) => {
    await vercel().edgeCache.invalidateBySrcImages({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { srcImages },
    });
    return JSON.stringify({ ok: true, invalidated: srcImages });
  },
});
