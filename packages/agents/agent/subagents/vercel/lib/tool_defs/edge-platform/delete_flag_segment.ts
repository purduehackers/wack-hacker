import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_flag_segment = defineTool({
  description: "Delete a targeting segment.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    segment_id: z.string(),
  }),
  execute: async ({ project_id_or_name, segment_id }) => {
    await vercel().featureFlags.deleteFlagSegment({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      segmentIdOrSlug: segment_id,
    });
    return JSON.stringify({ ok: true, id: segment_id });
  },
});
