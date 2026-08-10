import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const list_users = defineTool({
  description:
    "List all workspace members. Returns name, display name, email, role flags (admin/owner/guest), active status, and profile URL.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const r = await linear.users();
    return JSON.stringify(
      r.nodes.map((u) => ({
        id: u.id,
        name: u.name,
        displayName: u.displayName,
        email: u.email,
        admin: u.admin,
        owner: u.owner,
        guest: u.guest,
        active: u.active,
        url: u.url,
      })),
    );
  },
});
