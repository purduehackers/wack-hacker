import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const create_global_config_token = defineTool({
  description:
    "Create a new read token for a Global Config. **Does NOT return the token value** — only its id and label. Retrieve the secret from the Vercel dashboard to avoid leaking it into Discord/logs.",
  access: { risk: "write" },
  input: z.strictObject({
    global_config_id: z.string(),
    label: z.string(),
  }),
  execute: async ({ global_config_id, label }) => {
    const result = await vercel().edgeConfig.createEdgeConfigToken({
      ...TEAM,
      edgeConfigId: global_config_id,
      requestBody: { label },
    });
    // The SDK models the response as `{ token, id }`, so naming the one
    // non-secret field is a tighter guarantee than deep-dropping `token` — a
    // future secret-bearing field cannot leak through an explicit projection.
    return JSON.stringify({
      id: result.id,
      note: "Token value redacted. Retrieve it from the Vercel dashboard under Global Config → Tokens.",
    });
  },
});
