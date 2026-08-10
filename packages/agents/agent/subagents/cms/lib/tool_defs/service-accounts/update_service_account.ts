import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectServiceAccount, serviceAccountFields } from "../../constants.ts";

export const update_service_account = defineTool({
  description:
    "Update a service account. Set `revoked: true` to kill its API key without deleting the record (preserves audit trail).",
  access: { risk: "destructive" },
  input: z.strictObject({
    id: documentId,
    ...z.object(serviceAccountFields).partial().shape,
  }),
  execute: async ({ id, ...rest }) => {
    try {
      const data = {
        ...(rest.name !== undefined && { name: rest.name }),
        ...(rest.roles !== undefined && { roles: rest.roles }),
        ...(rest.revoked !== undefined && { revoked: rest.revoked }),
      };
      const doc = await payload.update({
        collection: "service-accounts",
        id,
        data,
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
