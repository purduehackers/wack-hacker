import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectUser } from "../../projections.ts";

export const get_user = defineTool({
  description: "Fetch a single CMS user by ID.",
  access: { risk: "read", minRole: "admin" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: "users",
        id,
      });
      return JSON.stringify(projectUser(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
