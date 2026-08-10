import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet, hcbOrgSlug } from "../../client.ts";
import {
  hcbDonationSchema,
  paginationInputShape,
  paginationQuery,
  projectDonation,
} from "../../constants.ts";

export const list_donations = defineTool({
  description:
    "List donations to the Hack Club Bank org — donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  access: { risk: "read" },
  input: z.strictObject(paginationInputShape),
  execute: async (input) => {
    const data = await hcbGet(
      `/organizations/${hcbOrgSlug()}/donations`,
      paginationQuery(input),
      z.array(hcbDonationSchema),
    );
    return data.map(projectDonation);
  },
});
