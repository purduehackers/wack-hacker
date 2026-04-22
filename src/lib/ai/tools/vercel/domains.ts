import { tool } from "ai";
import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── ALIASES ────────────────

export const list_aliases = tool({
  description:
    "List aliases for the active team. Filter by `domain`, `projectId`. Paginated via `limit`, `from`, `since`, `until`.",
  inputSchema: z.object({
    domain: z.string().optional(),
    from: z.number().optional(),
    limit: z.number().max(100).optional(),
    projectId: z.string().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
    rollbackDeploymentId: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().aliases.listAliases({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_alias = tool({
  description: "Retrieve a single alias by id or hostname.",
  inputSchema: z.object({
    id_or_alias: z.string(),
    from: z.number().optional(),
    projectId: z.string().optional(),
    since: z.number().optional(),
    until: z.number().optional(),
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

export const list_deployment_aliases = tool({
  description: "List every alias currently pointing at a specific deployment id.",
  inputSchema: z.object({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().aliases.listDeploymentAliases({ ...TEAM, id: deployment_id });
    return JSON.stringify(result);
  },
});

/** @destructive Assigns an alias to a deployment — shifts traffic. */
export const assign_alias = tool({
  description: "Assign an alias (hostname) to a deployment.",
  inputSchema: z.object({
    deployment_id: z.string(),
    alias: z.string().describe("The hostname to assign (e.g. 'staging.purduehackers.com')"),
    redirect: z.string().optional(),
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

/** @destructive Deletes an alias — breaks any traffic using it. */
export const delete_alias = tool({
  description: "Delete an alias by id or hostname.",
  inputSchema: z.object({ id_or_alias: z.string() }),
  execute: async ({ id_or_alias }) => {
    const result = await vercel().aliases.deleteAlias({ ...TEAM, aliasId: id_or_alias });
    return JSON.stringify(result);
  },
});

// ──────────────── DOMAINS ────────────────

export const list_domains = tool({
  description: "List all apex domains registered to the active team.",
  inputSchema: z.object({
    limit: z.number().max(100).optional(),
    since: z.number().optional(),
    until: z.number().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().domains.getDomains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_domain = tool({
  description: "Retrieve a domain by name.",
  inputSchema: z.object({ domain: z.string() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.getDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_domain_config = tool({
  description:
    "Retrieve a domain's DNS / nameserver configuration — useful for diagnosing verification failures.",
  inputSchema: z.object({
    domain: z.string(),
    strict: z.enum(["true", "false"]).optional(),
  }),
  execute: async ({ domain, strict }) => {
    const result = await vercel().domains.getDomainConfig({ ...TEAM, domain, strict });
    return JSON.stringify(result);
  },
});

/** @destructive Removes a domain from the team. Cannot be undone. */
export const delete_domain = tool({
  description:
    "Remove a domain from the team. The registration itself may persist at the registrar.",
  inputSchema: z.object({ domain: z.string() }),
  execute: async ({ domain }) => {
    const result = await vercel().domains.deleteDomain({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

// ──────────────── DNS ────────────────

export const list_dns_records = tool({
  description: "List DNS records for a domain managed by Vercel nameservers.",
  inputSchema: z.object({
    domain: z.string(),
    limit: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
  }),
  execute: async ({ domain, ...query }) => {
    const result = await vercel().dns.getRecords({ ...TEAM, domain, ...query });
    return JSON.stringify(result);
  },
});

/** @destructive Removes a DNS record. */
export const remove_dns_record = tool({
  description: "Remove a DNS record from a Vercel-managed domain.",
  inputSchema: z.object({
    domain: z.string(),
    record_id: z.string(),
  }),
  execute: async ({ domain, record_id }) => {
    const result = await vercel().dns.removeRecord({ ...TEAM, domain, recordId: record_id });
    return JSON.stringify(result);
  },
});

// ──────────────── REGISTRAR QUERIES ────────────────

export const list_supported_tlds = tool({
  description: "List top-level domains supported by the Vercel registrar.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().domainsRegistrar.getSupportedTlds({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const check_domain_availability = tool({
  description: "Check whether a domain is available to register.",
  inputSchema: z.object({ domain: z.string() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAvailability({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_domain_price = tool({
  description: "Get the price to register a specific domain for N years.",
  inputSchema: z.object({
    domain: z.string(),
    years: z.string().optional(),
  }),
  execute: async ({ domain, years }) => {
    const result = await vercel().domainsRegistrar.getDomainPrice({ ...TEAM, domain, years });
    return JSON.stringify(result);
  },
});

export const get_domain_auth_code = tool({
  description: "Retrieve the transfer auth code for a domain registered at the Vercel registrar.",
  inputSchema: z.object({ domain: z.string() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainAuthCode({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_domain_transfer_in_status = tool({
  description: "Get status of a pending inbound domain transfer.",
  inputSchema: z.object({ domain: z.string() }),
  execute: async ({ domain }) => {
    const result = await vercel().domainsRegistrar.getDomainTransferIn({ ...TEAM, domain });
    return JSON.stringify(result);
  },
});

export const get_registrar_order = tool({
  description: "Retrieve a registrar order (from buy/transfer/renew) by its id.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    const result = await vercel().domainsRegistrar.getOrder({ ...TEAM, orderId });
    return JSON.stringify(result);
  },
});

// ──────────────── CERTS ────────────────

export const get_cert = tool({
  description: "Retrieve a TLS certificate by id.",
  inputSchema: z.object({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.getCertById({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});

/** @destructive Issues a new TLS cert for the given hostnames. */
export const issue_cert = tool({
  description: "Issue a new TLS certificate for one or more hostnames on the team's domains.",
  inputSchema: z.object({
    cns: z.array(z.string()).min(1).describe("Hostnames to include in the cert"),
  }),
  execute: async ({ cns }) => {
    const result = await vercel().certs.issueCert({ ...TEAM, requestBody: { cns } });
    return JSON.stringify(result);
  },
});

/** @destructive Removes a TLS cert — breaks HTTPS for anything bound to it. */
export const remove_cert = tool({
  description: "Remove a TLS certificate.",
  inputSchema: z.object({ cert_id: z.string() }),
  execute: async ({ cert_id }) => {
    const result = await vercel().certs.removeCert({ ...TEAM, id: cert_id });
    return JSON.stringify(result);
  },
});
