import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const issue_cert = defineTool({
  description: "Issue a new TLS certificate for one or more hostnames on the team's domains.",
  access: { risk: "destructive" },
  input: z.strictObject({
    cns: z.array(z.string()).min(1).describe("Hostnames to include in the cert"),
  }),
  execute: async ({ cns }) => {
    const result = await vercel().certs.issueCert({ ...TEAM, requestBody: { cns } });
    return JSON.stringify(result);
  },
});
