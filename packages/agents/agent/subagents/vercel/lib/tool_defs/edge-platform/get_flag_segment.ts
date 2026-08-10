import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_flag_segment = defineTool({
  description: "Get a specific flag segment.",
  access: { risk: "read" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    segment_id: z.string(),
    withMetadata: z.boolean().optional(),
  }),
  execute: async ({ project_id_or_name, segment_id, withMetadata }) => {
    const result = await vercel().featureFlags.getFlagSegment({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      segmentIdOrSlug: segment_id,
      withMetadata: withMetadata ?? false,
    });
    return JSON.stringify(result);
  },
});
