import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { hcbGet } from "../../client.ts";
import { hcbDonationSchema, projectDonation } from "../../constants.ts";

export const get_donation = defineTool({
  description:
    "Fetch a single donation by ID. Returns donor name (or '(anonymous)'), amount_cents, status, recurring flag, and message.",
  access: { risk: "read" },
  input: z.strictObject({
    id: z.string().describe("Donation ID"),
  }),
  execute: async ({ id }) => {
    const data = await hcbGet(`/donations/${id}`, undefined, hcbDonationSchema);
    return projectDonation(data);
  },
});
