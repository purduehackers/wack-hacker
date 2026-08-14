import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { userFields } from "../../constants.ts";
import { projectUser } from "../../projections.ts";

export const update_user = defineTool({
  description:
    "Update a CMS user's email or roles. Pass `roles` to replace the user's role set entirely (not a merge).",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    id: documentId,
    ...z.object(userFields).omit({ password: true }).partial().shape,
  }),
  execute: async ({ id, email, roles }) => {
    try {
      const data = {
        ...(email !== undefined && { email }),
        ...(roles !== undefined && { roles }),
      };
      const doc = await payload.update({
        collection: "users",
        id,
        data,
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
