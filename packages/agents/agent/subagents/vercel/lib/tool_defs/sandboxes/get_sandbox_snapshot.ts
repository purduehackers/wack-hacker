import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_sandbox_snapshot = defineTool({
  description: "Retrieve a sandbox snapshot by id.",
  access: { risk: "read" },
  input: z.strictObject({ snapshot_id: z.string() }),
  execute: async ({ snapshot_id }) => {
    const result = await vercel().sandboxes.getSnapshot({
      ...TEAM,
      snapshotId: snapshot_id,
    });
    return JSON.stringify(result);
  },
});
