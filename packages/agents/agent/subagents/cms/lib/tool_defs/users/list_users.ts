import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape } from "../../constants.ts";
import { projectUser } from "../../projections.ts";

export const list_users = defineTool({
  description:
    "List CMS user accounts (email + assigned roles). The `users` collection holds every human account regardless of role; filter by `email` to find one. Roles follow a hierarchy: admin > editor > viewer. Additional scoped roles: hack_night_dashboard, events_website, wack_hacker.",
  access: { risk: "read", minRole: "admin" },
  input: z.strictObject({
    ...paginationInputShape,
    email: z.email().optional().describe("Filter by exact email address"),
  }),
  execute: async ({ email, ...input }) => {
    try {
      const res = await payload.find({
        collection: "users",
        ...paginationQuery(input),
        ...(email !== undefined && { where: { email: { equals: email } } }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectUser),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
