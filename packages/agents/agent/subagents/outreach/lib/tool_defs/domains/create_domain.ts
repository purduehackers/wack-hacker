import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../../../lib/policy/domain-tools.ts";
import { resend } from "../../client.ts";

export const create_domain = defineTool({
  description:
    "Register a new sending domain on Resend. Returns the DNS records that must be added at the registrar before the domain can be verified.",
  access: { risk: "destructive", minRole: "admin" },
  requires: "RESEND_API_KEY",
  input: z.strictObject({
    name: z.string().describe("Domain (e.g. 'sales.example.com')"),
    region: z
      .enum(["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"])
      .optional()
      .describe("Sending region (default us-east-1)"),
  }),
  execute: async ({ name, region }) => {
    const result = await resend().domains.create({
      name,
      ...(region === undefined ? {} : { region }),
    });
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});
