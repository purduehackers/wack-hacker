import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { resend } from "./client.ts";

export const list_domains = defineTool({
  description:
    "List verified sending domains on Resend. Returns domain name, region, status (pending, verified, failed), and created date.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await resend().domains.list();
    if (result.error) return { error: result.error.message };
    return result.data?.data ?? [];
  },
});

export const get_domain = defineTool({
  description: "Get a single Resend domain by ID, including DNS records and verification status.",
  access: { risk: "read" },
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.get(domain_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});

export const create_domain = defineTool({
  description:
    "Register a new sending domain on Resend. Returns the DNS records that must be added at the registrar before the domain can be verified.",
  access: { risk: "destructive", minRole: "admin" },
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

export const verify_domain = defineTool({
  description:
    "Kick off verification for a Resend domain. DNS records must already be added; this tells Resend to re-check them.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.verify(domain_id);
    if (result.error) return { error: result.error.message };
    return result.data;
  },
});

export const delete_domain = defineTool({
  description:
    "Permanently delete a Resend domain. All sending from that domain stops immediately.",
  access: { risk: "destructive", minRole: "admin" },
  input: z.strictObject({
    domain_id: z.string().describe("Resend domain ID"),
  }),
  execute: async ({ domain_id }) => {
    const result = await resend().domains.remove(domain_id);
    if (result.error) return { error: result.error.message };
    return { deleted: true, domain_id };
  },
});
