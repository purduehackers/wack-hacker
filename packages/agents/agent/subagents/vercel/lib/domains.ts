import { z } from "zod";

import { defineDomainTool as defineTool } from "../../../lib/policy/domain-tools.ts";
import { vercel } from "./client.ts";
import { TEAM } from "./constants.ts";
import { epochMillis, numericString, pageLimit } from "./fields.ts";

// ──────────────── ALIASES ────────────────

export const list_aliases = defineTool({
  description:
    "List aliases for the active team. Filter by `domain`, `projectId`. Paginated via `limit`, `from`, `since`, `until`.",
  access: { risk: "read" },
  input: z.strictObject({
    // Not `z.hostname()`: aliases may be wildcards (`*.purduehackers.com`).
    domain: z.string().optional().describe("Filter to this alias domain; may be a wildcard"),
    from: epochMillis.optional(),
    limit: pageLimit.max(100).optional(),
    projectId: z.string().optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
    rollbackDeploymentId: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().aliases.listAliases({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_alias = defineTool({
  description: "Retrieve a single alias by id or hostname.",
  access: { risk: "read" },
  input: z.strictObject({
    id_or_alias: z.string(),
    from: epochMillis.optional(),
    projectId: z.string().optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async ({ id_or_alias, ...query }) => {
    const result = await vercel().aliases.getAlias({
      ...TEAM,
      idOrAlias: id_or_alias,
      ...query,
    });
    return JSON.stringify(result);
  },
});

export const list_deployment_aliases = defineTool({
  description: "List every alias currently pointing at a specific deployment id.",
  access: { risk: "read" },
  input: z.strictObject({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().aliases.listDeploymentAliases({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});

export const assign_alias = defineTool({
  description: "Assign an alias (hostname) to a deployment.",
  access: { risk: "destructive" },
  input: z.strictObject({
    deployment_id: z.string(),
    // Not `z.hostname()`: a wildcard alias (`*.purduehackers.com`) is assignable.
    alias: z.string().describe("The hostname to assign (e.g. 'staging.purduehackers.com')"),
    redirect: z
      .hostname()
      .optional()
      .describe("Hostname to 307-redirect to instead of the deployment"),
  }),
  execute: async ({ deployment_id, alias, redirect }) => {
    const result = await vercel().aliases.assignAlias({
      ...TEAM,
      id: deployment_id,
      requestBody: { alias, redirect },
    });
    return JSON.stringify(result);
  },
});

export const delete_alias = defineTool({
  description: "Delete an alias by id or hostname.",
  access: { risk: "destructive" },
  input: z.strictObject({ id_or_alias: z.string() }),
  execute: async ({ id_or_alias }) => {
    const result = await vercel().aliases.deleteAlias({ ...TEAM, aliasId: id_or_alias });
    return JSON.stringify(result);
  },
});

// ──────────────── DOMAINS ────────────────

export const list_domains = defineTool({
  description: "List all apex domains registered to the active team.",
  access: { risk: "read" },
  input: z.strictObject({
    limit: pageLimit.max(100).optional(),
    since: epochMillis.optional(),
    until: epochMillis.optional(),
  }),
  execute: async (input) => {
    const result = await vercel().domains.getDomains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_domain = defineTool({
  description: "Retrieve a domain by name.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.getDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

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

export const delete_domain = defineTool({
  description:
    "Remove a domain from the team. The registration itself may persist at the registrar.",
  access: { risk: "destructive" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.deleteDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

// ──────────────── DNS ────────────────

export const list_dns_records = defineTool({
  description: "List DNS records for a domain managed by Vercel nameservers.",
  access: { risk: "read" },
  input: z.strictObject({
    domain: z.hostname(),
    limit: numericString.optional(),
    since: numericString.optional().describe("JavaScript timestamp (ms) lower bound"),
    until: numericString.optional().describe("JavaScript timestamp (ms) upper bound"),
  }),
  execute: async ({ domain, ...query }) => {
    const result = await vercel().dns.getRecords({ ...TEAM, domain, ...query });
    return JSON.stringify(result);
  },
});

export const remove_dns_record = defineTool({
  description: "Remove a DNS record from a Vercel-managed domain.",
  access: { risk: "destructive" },
  input: z.strictObject({
    domain: z.hostname(),
    record_id: z.string(),
  }),
  execute: async ({ domain, record_id }) => {
    const result = await vercel().dns.removeRecord({ ...TEAM, domain, recordId: record_id });
    return JSON.stringify(result);
  },
});

// ──────────────── REGISTRAR QUERIES ────────────────

export const list_supported_tlds = defineTool({
  description: "List top-level domains supported by the Vercel registrar.",
  access: { risk: "read" },
  input: z.strictObject({}),
  execute: async () => {
    const result = await vercel().domainsRegistrar.getSupportedTlds({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const check_domain_availability = defineTool({
  description: "Check whether a domain is available to register.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAvailability({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_domain_price = defineTool({
  description: "Get the price to register a specific domain for N years.",
  access: { risk: "read" },
  input: z.strictObject({
    domain: z.hostname(),
    years: numericString.optional(),
  }),
  execute: async ({ domain, years }) => {
    const result = await vercel().domainsRegistrar.getDomainPrice({ ...TEAM, domain, years });
    return JSON.stringify(result);
  },
});

export const get_domain_auth_code = defineTool({
  description: "Retrieve the transfer auth code for a domain registered at the Vercel registrar.",
  access: { risk: "destructive" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAuthCode({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_domain_transfer_in_status = defineTool({
  description: "Get status of a pending inbound domain transfer.",
  access: { risk: "read" },
  input: z.strictObject({ domain: z.hostname() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainTransferIn({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_registrar_order = defineTool({
  description: "Retrieve a registrar order (from buy/transfer/renew) by its id.",
  access: { risk: "read" },
  input: z.strictObject({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    const result = await vercel().domainsRegistrar.getOrder({ ...TEAM, orderId });
    return JSON.stringify(result);
  },
});

// ──────────────── CERTS ────────────────

export const get_cert = defineTool({
  description: "Retrieve a TLS certificate by id.",
  access: { risk: "read" },
  input: z.strictObject({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.getCertById({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});

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

export const remove_cert = defineTool({
  description: "Remove a TLS certificate.",
  access: { risk: "destructive" },
  input: z.strictObject({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.removeCert({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});
