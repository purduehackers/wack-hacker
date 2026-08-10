import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { payload, wrapPayloadError } from "../../client.ts";
import { projectServiceAccount, serviceAccountFields } from "../../constants.ts";

export const create_service_account = defineTool({
  description:
    "Create a new service account. The API key itself is minted in the Payload admin UI after creation — this tool only provisions the identity and its roles.",
  access: { risk: "destructive" },
  input: z.strictObject(serviceAccountFields),
  execute: async ({ name, roles, revoked }) => {
    try {
      const doc = await payload.create({
        collection: "service-accounts",
        data: { name, roles, revoked: revoked ?? false },
      });
      return JSON.stringify(projectServiceAccount(doc));
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
