import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { pageLimit, TEAM } from "../../constants.ts";

export const list_contract_commitments = defineTool({
  description: "List contractual billing commitments.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.optional(),
  }),
  execute: async (input) => {
    const result = await vercel().billing.listContractCommitments({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
