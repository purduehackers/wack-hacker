import { tool } from "ai";
import { z } from "zod";

import { approval } from "../../approvals/index.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── CONFIGURATIONS ────────────────

export const list_integration_configurations = tool({
  description:
    "List every integration installed on the team (marketplace apps — Turso, Upstash, Neon, etc.). `view` is required.",
  inputSchema: z.object({
    view: z.enum(["account", "project"]),
    integrationIdOrSlug: z.string().optional(),
    installationType: z.enum(["marketplace", "external"]).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.getConfigurations({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_integration_configuration = tool({
  description: "Get a specific integration configuration by id.",
  inputSchema: z.object({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    const result = await vercel().integrations.getConfiguration({
      ...TEAM,
      id: configuration_id,
    });
    return JSON.stringify(result);
  },
});

export const get_integration_configuration_products = tool({
  description: "List products offered by an installed integration — e.g. Postgres / Redis / Blob.",
  inputSchema: z.object({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    const result = await vercel().integrations.getConfigurationProducts({
      ...TEAM,
      id: configuration_id,
    });
    return JSON.stringify(result);
  },
});

export const get_integration_billing_plans = tool({
  description:
    "List billing plans for a specific product of an integration. Use the returned plan id in `create_integration_store_direct`.",
  inputSchema: z.object({
    integration_id_or_slug: z
      .string()
      .describe("The integration slug/id (e.g. 'turso', 'upstash')"),
    product_id_or_slug: z.string().describe("The product slug/id (e.g. 'database', 'kv')"),
    integration_configuration_id: z.string().optional(),
  }),
  execute: async ({ integration_id_or_slug, product_id_or_slug, integration_configuration_id }) => {
    const result = await vercel().integrations.getBillingPlans({
      ...TEAM,
      integrationIdOrSlug: integration_id_or_slug,
      productIdOrSlug: product_id_or_slug,
      integrationConfigurationId: integration_configuration_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_integration_configuration = approval(
  tool({
    description: "Uninstall an integration.",
    inputSchema: z.object({ configuration_id: z.string() }),
    execute: async ({ configuration_id }) => {
      await vercel().integrations.deleteConfiguration({ ...TEAM, id: configuration_id });
      return JSON.stringify({ ok: true, id: configuration_id });
    },
  }),
);

// ──────────────── PROVISIONING STORES ────────────────

export const create_integration_store_direct = approval(
  tool({
    description:
      "Provision a new integration resource — e.g. a Turso database, Upstash Redis, Neon Postgres, Vercel Blob. Returns a resource id to pass to `connect_integration_resource_to_project`.",
    inputSchema: z.object({
      integration_configuration_id: z.string(),
      integration_product_id_or_slug: z.string(),
      name: z.string(),
      metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      externalId: z.string().optional(),
    }),
    execute: async ({
      integration_configuration_id,
      integration_product_id_or_slug,
      name,
      metadata,
      externalId,
    }) => {
      const result = await vercel().integrations.createIntegrationStoreDirect({
        ...TEAM,
        requestBody: {
          name,
          integrationConfigurationId: integration_configuration_id,
          integrationProductIdOrSlug: integration_product_id_or_slug,
          metadata,
          externalId,
        },
      });
      return JSON.stringify(result);
    },
  }),
);

export const connect_integration_resource_to_project = tool({
  description:
    "Connect a provisioned integration resource to a Vercel project. Auto-populates env vars. Trigger a new deploy for them to take effect.",
  inputSchema: z.object({
    integration_configuration_id: z.string(),
    resource_id: z.string(),
    project_id: z.string(),
  }),
  execute: async ({ integration_configuration_id, resource_id, project_id }) => {
    await vercel().integrations.connectIntegrationResourceToProject({
      ...TEAM,
      integrationConfigurationId: integration_configuration_id,
      resourceId: resource_id,
      requestBody: { projectId: project_id },
    });
    return JSON.stringify({
      ok: true,
      configurationId: integration_configuration_id,
      resourceId: resource_id,
      projectId: project_id,
      note: "Env vars auto-populated. Trigger a new deployment for them to take effect.",
    });
  },
});

// ──────────────── MARKETPLACE RESOURCES ────────────────

export const list_integration_resources = tool({
  description:
    "List every resource provisioned under an integration installation (e.g. every Turso DB under the Turso integration).",
  inputSchema: z.object({ configuration_id: z.string() }),
  execute: async ({ configuration_id }) => {
    const result = await vercel().marketplace.getIntegrationResources({
      integrationConfigurationId: configuration_id,
    });
    return JSON.stringify(result);
  },
});

export const get_integration_resource = tool({
  description: "Retrieve a specific integration resource by id.",
  inputSchema: z.object({
    configuration_id: z.string(),
    resource_id: z.string(),
  }),
  execute: async ({ configuration_id, resource_id }) => {
    const result = await vercel().marketplace.getIntegrationResource({
      integrationConfigurationId: configuration_id,
      resourceId: resource_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_integration_resource = approval(
  tool({
    description:
      "Permanently delete a provisioned integration resource (e.g. drop a Turso DB). Data is LOST.",
    inputSchema: z.object({
      configuration_id: z.string(),
      resource_id: z.string(),
    }),
    execute: async ({ configuration_id, resource_id }) => {
      await vercel().marketplace.deleteIntegrationResource({
        integrationConfigurationId: configuration_id,
        resourceId: resource_id,
      });
      return JSON.stringify({ ok: true, resourceId: resource_id });
    },
  }),
);

// ──────────────── GIT SEARCH ────────────────

export const list_git_namespaces = tool({
  description:
    "List Git namespaces (orgs/users) accessible to the team across GitHub/GitLab/Bitbucket integrations.",
  inputSchema: z.object({
    host: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    provider: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.gitNamespaces({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const search_git_repos = tool({
  description:
    "Search Git repos available to the team across installed Git integrations — use when creating a new project from a repo.",
  inputSchema: z.object({
    host: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    provider: z.enum(["github", "github-custom-host", "gitlab", "bitbucket"]).optional(),
    namespaceId: z.string().optional(),
    query: z.string().optional(),
    installationId: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().integrations.searchRepo({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});
