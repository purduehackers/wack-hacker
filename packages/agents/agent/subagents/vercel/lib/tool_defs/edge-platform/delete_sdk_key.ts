import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const delete_sdk_key = defineTool({
  description: "Delete a feature-flags SDK key.",
  access: { risk: "destructive" },
  input: z.strictObject({
    project_id_or_name: z.string(),
    key_id: z.string(),
  }),
  execute: async ({ project_id_or_name, key_id }) => {
    await vercel().featureFlags.deleteSDKKey({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      hashKey: key_id,
    });
    return JSON.stringify({ ok: true, id: key_id });
  },
});
