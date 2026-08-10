import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_sandbox_snapshot = defineTool({
  description: "Delete a sandbox snapshot.",
  access: { risk: "destructive" },
  input: z.strictObject({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.deleteSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});
