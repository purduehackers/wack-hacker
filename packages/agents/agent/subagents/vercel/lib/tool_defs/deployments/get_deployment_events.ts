import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { epochMillis, pageLimit, TEAM } from "../../constants.ts";

export const get_deployment_events = defineTool({
  description:
    "Fetch build events / logs for a deployment in JSON mode. Returns an array of events (stdout, stderr, stage transitions). Hard-capped at `limit` (max 200).",
  access: { risk: "read" },
  input: z.strictObject({
    deployment_id: z.string(),
    limit: pageLimit.max(200).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    follow: z.literal([0, 1]).optional().describe("1 to follow (stream); 0 for one-shot"),
    builds: z.int().optional(),
    direction: z.enum(["backward", "forward"]).optional(),
    name: z.string().optional(),
    statusCode: z.string().optional(),
    delimiter: z.int().optional(),
  }),
  execute: async ({ deployment_id, limit, ...query }) => {
    const cappedLimit = limit !== undefined ? Math.min(limit, 200) : 200;
    const result = await vercel().deployments.getDeploymentEvents({
      ...TEAM,
      idOrUrl: deployment_id,
      ...query,
      limit: cappedLimit,
    });
    return JSON.stringify(result);
  },
});
