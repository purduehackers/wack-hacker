import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { projectUser, userFields } from "../../constants.ts";

export const create_user = defineTool({
  description:
    "Invite a new CMS user. Assigns the given roles. Role hierarchy is enforced server-side (admin implies editor implies viewer).",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject(userFields),
  execute: async ({ email, password, roles }) => {
    try {
      const doc = await payload.create({
        collection: "users",
        data: { email, password, roles },
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
