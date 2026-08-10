import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";

export const list_auth_tokens = defineTool({
  description: "List auth tokens for the currently-authenticated user.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().authentication.listAuthTokens();
    return JSON.stringify(result);
  },
});
