import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { paginationQuery, payload, wrapPayloadError } from "../../client.ts";
import { paginationInputShape } from "../../constants.ts";
import { projectServiceAccount } from "../../projections.ts";

export const list_service_accounts = defineTool({
  description:
    "List service accounts (API-key-only CMS identities used by bots and integrations). Each has a name, revoked flag, and role set.",
  access: { risk: "read" },
  input: z.strictObject({
    ...paginationInputShape,
    revoked_only: z
      .boolean()
      .optional()
      .describe("When true, return only revoked service accounts"),
  }),
  execute: async ({ revoked_only, ...input }) => {
    try {
      const res = await payload.find({
        collection: "service-accounts",
        ...paginationQuery(input),
        ...(revoked_only && { where: { revoked: { equals: true } } }),
      });
      return JSON.stringify({
        total_docs: res.totalDocs,
        total_pages: res.totalPages,
        page: res.page,
        docs: res.docs.map(projectServiceAccount),
      });
    } catch (err) {
      throw wrapPayloadError(err);
    }
  },
});
