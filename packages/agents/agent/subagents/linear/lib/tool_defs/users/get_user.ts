import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { linear } from "../../client.ts";

export const get_user = defineTool({
  description:
    "Get a user's full profile by ID — name, email, display name, roles, timezone, current status, issue count, and profile URL.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("User UUID"),
  }),
  execute: async ({ id }) => {
    const u = await linear.user(id);
    return JSON.stringify({
      id: u.id,
      name: u.name,
      displayName: u.displayName,
      email: u.email,
      admin: u.admin,
      owner: u.owner,
      guest: u.guest,
      active: u.active,
      timezone: u.timezone,
      statusEmoji: u.statusEmoji,
      statusLabel: u.statusLabel,
      createdIssueCount: u.createdIssueCount,
      url: u.url,
    });
  },
});
