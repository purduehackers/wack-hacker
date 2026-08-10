import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const delete_auth_token = defineTool({
  description: "Revoke (delete) an auth token.",
  access: { risk: "destructive" },
  input: z.strictObject({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.deleteAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});
