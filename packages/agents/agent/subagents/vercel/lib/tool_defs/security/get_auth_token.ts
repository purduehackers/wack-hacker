import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const get_auth_token = defineTool({
  description: "Retrieve a specific auth token's metadata.",
  access: { risk: "read" },
  input: z.strictObject({ token_id: z.string() }),
  execute: async ({ token_id }) => {
    const result = await vercel().authentication.getAuthToken({ tokenId: token_id });
    return JSON.stringify(result);
  },
});
