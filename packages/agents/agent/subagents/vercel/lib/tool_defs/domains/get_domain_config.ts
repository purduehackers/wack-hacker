import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { vercel } from "../../client.ts";
import { TEAM } from "../../constants.ts";

export const get_domain_config = defineTool({
  description:
    "Retrieve a domain's DNS / nameserver configuration — useful for diagnosing verification failures.",
  access: { risk: "read" },
  input: z.strictObject({
    // Not `z.hostname()`: this is the endpoint used to diagnose a project
    // domain's DNS, and a project domain may be a wildcard.
    domain: z.string().describe("Domain name, may be a wildcard like *.example.com"),
    strict: z.enum(["true", "false"]).optional(),
  }),
  execute: async ({ domain, strict }) => {
    const result = await vercel().domains.getDomainConfig({ ...TEAM, domain, strict });
    return JSON.stringify(result);
  },
});
