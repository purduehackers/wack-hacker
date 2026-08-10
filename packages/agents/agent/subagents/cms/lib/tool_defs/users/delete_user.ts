import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";

export const delete_user = defineTool({
  description:
    "Remove a CMS user permanently. Loses their sessions and audit trail — prefer updating roles to strip access when possible.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.delete({
        collection: "users",
        id,
      });
      return JSON.stringify({ deleted: true, id: doc.id ?? id });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
