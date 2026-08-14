import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { notion } from "../../client.ts";
import { cursorPaginationInputShape } from "../../shared-constants.ts";

export const list_users = defineTool({
  description: `List workspace users. Returns name, email, type (person or bot), and avatar URL. Use to resolve user names to IDs for people properties.`,
  access: { risk: "read" },
  input: z.strictObject({
    ...cursorPaginationInputShape,
  }),
  execute: async ({ start_cursor, page_size }) => {
    const { results, has_more, next_cursor } = await notion.users.list({
      ...(start_cursor !== undefined && { start_cursor }),
      page_size: page_size ?? 50,
    });
    return {
      users: results.map((u) => ({
        id: u.id,
        name: u.name,
        type: u.type,
        avatar_url: u.avatar_url,
        email: u.type === "person" ? u.person.email : undefined,
      })),
      has_more,
      next_cursor,
    };
  },
});
