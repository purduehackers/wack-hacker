import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "../../constants.ts";

export const whoami = defineTool({
  description:
    "Return the authenticated Vercel user and the active Purdue Hackers team context. Useful as a debug smoke test.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const user = await vercel().user.getAuthUser();
    return JSON.stringify({
      user,
      team: { id: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG },
    });
  },
});
