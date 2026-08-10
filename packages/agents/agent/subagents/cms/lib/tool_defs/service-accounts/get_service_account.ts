import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { documentId, payload, wrapPayloadError } from "../../client.ts";
import { projectServiceAccount } from "../../constants.ts";

export const get_service_account = defineTool({
  description: "Fetch a single service account by ID.",
  access: { risk: "read" },
  input: z.strictObject({ id: documentId }),
  execute: async ({ id }) => {
    try {
      const doc = await payload.findByID({
        collection: "service-accounts",
        id,
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
