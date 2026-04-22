import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { admin } from "../../skills/index.ts";
import { resend } from "./client.ts";

export const list_domains = tool({
  description:
    "List verified sending domains on Resend. Returns domain name, region, status (pending, verified, failed), and created date.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await resend().domains.list();
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data?.data ?? []);
  },
});

export const get_domain = tool({
  description: "Get a single Resend domain by ID, including DNS records and verification status.",
  inputSchema: z.object({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.get(domain_id);
    if (result.error) return JSON.stringify({ error: result.error.message });
    return JSON.stringify(result.data);
  },
});

export const create_domain = admin(
  tool({
    description:
      "Register a new sending domain on Resend. Returns the DNS records that must be added at the registrar before the domain can be verified.",
    inputSchema: z.object({
      name: z.string().describe("Domain (e.g. 'sales.example.com')"),
      region: z
        .enum(["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"])
        .optional()
        .describe("Sending region (default us-east-1)"),
    }),
    execute: async ({ name, region }) => {
      const result = await resend().domains.create({ name, region });
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify(result.data);
    },
  }),
);

export const verify_domain = admin(
  tool({
    description:
      "Kick off verification for a Resend domain. DNS records must already be added; this tells Resend to re-check them.",
    inputSchema: z.object({
      domain_id: z.string().describe("Resend domain ID"),
    }),
    execute: async ({ domain_id }) => {
      const result = await resend().domains.verify(domain_id);
      if (result.error) return JSON.stringify({ error: result.error.message });
      return JSON.stringify(result.data);
    },
  }),
);

export const delete_domain = admin(
  approval(
    tool({
      description:
        "Permanently delete a Resend domain. All sending from that domain stops immediately.",
      inputSchema: z.object({
        domain_id: z.string().describe("Resend domain ID"),
      }),
      execute: async ({ domain_id }) => {
        const result = await resend().domains.remove(domain_id);
        if (result.error) return JSON.stringify({ error: result.error.message });
        return JSON.stringify({ deleted: true, domain_id });
      },
    }),
  ),
);
