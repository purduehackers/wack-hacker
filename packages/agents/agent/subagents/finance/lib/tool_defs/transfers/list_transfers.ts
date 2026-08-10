import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import {
  hcbTransferSchema,
  paginationInputShape,
  paginationQuery,
  projectTransfer,
} from "../../constants.ts";

export const list_transfers = defineTool({
  description:
    "List HCB inter-org transfers (disbursements) involving Purdue Hackers — sender, receiver, amount_cents, status, and memo.",
  access: { risk: "read" },
  input: z.strictObject(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/transfers`,
      paginationQuery(input),
      z.array(hcbTransferSchema),
    );
    return data.map(projectTransfer);
  },
});
