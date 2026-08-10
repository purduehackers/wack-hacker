import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";

export const retrieve_user = defineTool({
  description:
    "Get a single Notion user by ID. Returns name, email (for people), type (person or bot), and avatar URL.",
  access: { risk: "read" },
  input: z.strictObject({
    user_id: z.string().describe("Notion user UUID"),
  }),
  execute: async ({ user_id }) => {
    const u = await notion.users.retrieve({ user_id });
    return {
      id: u.id,
      name: u.name,
      type: u.type,
      avatar_url: u.avatar_url,
      email: u.type === "person" ? u.person.email : undefined,
    };
  },
});
