import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";
import { defineTool } from "./define-tool.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── RUNTIME LOGS ────────────────

export const get_runtime_logs = defineTool({
  name: "get_runtime_logs",
  domain: "vercel",
  description:
    "Fetch runtime logs for a specific deployment. Returns platform/runtime logs (cold starts, function invocation, timeouts). For application errors, prefer the Sentry subagent.",
  access: { risk: "read" },
  input: z.object({
    project_id: z.string(),
    deployment_id: z.string(),
  }),
  execute: async ({ project_id, deployment_id }) => {
    const result = await vercel().logs.getRuntimeLogs({
      ...TEAM,
      projectId: project_id,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── LOG DRAINS ────────────────

export const list_log_drains = defineTool({
  name: "list_log_drains",
  domain: "vercel",
  description: "List every configurable log drain on the team.",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string().optional(),
    projectIdOrName: z.string().optional(),
  }),
  execute: async (input) => {
    const result = await vercel().logDrains.getAllLogDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_log_drain = defineTool({
  name: "get_log_drain",
  domain: "vercel",
  description: "Retrieve a configurable log drain by id.",
  access: { risk: "read" },
  input: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    const result = await vercel().logDrains.getConfigurableLogDrain({ ...TEAM, id: drain_id });
    return JSON.stringify(result);
  },
});

export const delete_configurable_log_drain = defineTool({
  name: "delete_configurable_log_drain",
  domain: "vercel",
  description: "Delete a configurable log drain.",
  access: { risk: "destructive" },
  input: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    await vercel().logDrains.deleteConfigurableLogDrain({ ...TEAM, id: drain_id });
    return JSON.stringify({ ok: true, id: drain_id });
  },
});

export const list_integration_log_drains = defineTool({
  name: "list_integration_log_drains",
  domain: "vercel",
  description: "List integration-backed log drains (created by installed integrations).",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().logDrains.getIntegrationLogDrains({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const delete_integration_log_drain = defineTool({
  name: "delete_integration_log_drain",
  domain: "vercel",
  description: "Delete an integration log drain.",
  access: { risk: "destructive" },
  input: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    await vercel().logDrains.deleteIntegrationLogDrain({ ...TEAM, id: drain_id });
    return JSON.stringify({ ok: true, id: drain_id });
  },
});

// ──────────────── DRAINS (newer generic API) ────────────────

export const list_drains = defineTool({
  name: "list_drains",
  domain: "vercel",
  description:
    "List every data drain (the newer generic drain API — supports logs, traces, metrics).",
  access: { risk: "read" },
  input: z.object({
    projectId: z.string().optional(),
    environments: z.array(z.string()).optional(),
  }),
  execute: async (input) => {
    const result = await vercel().drains.getDrains({ ...TEAM, ...input });
    return JSON.stringify(result);
  },
});

export const get_drain = defineTool({
  name: "get_drain",
  domain: "vercel",
  description: "Retrieve a drain by id.",
  access: { risk: "read" },
  input: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    const result = await vercel().drains.getDrain({ ...TEAM, id: drain_id });
    return JSON.stringify(result);
  },
});

export const delete_drain = defineTool({
  name: "delete_drain",
  domain: "vercel",
  description: "Delete a data drain.",
  access: { risk: "destructive" },
  input: z.object({ drain_id: z.string() }),
  execute: async ({ drain_id }) => {
    await vercel().drains.deleteDrain({ ...TEAM, id: drain_id });
    return JSON.stringify({ ok: true, id: drain_id });
  },
});

// ──────────────── OBSERVABILITY ────────────────

export const get_observability_config = defineTool({
  name: "get_observability_config",
  domain: "vercel",
  description: "Retrieve the API Observability configuration for the team.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().apiObservability.getObservabilityConfigurationProjects({
      ...TEAM,
    });
    return JSON.stringify(result);
  },
});

export const update_observability_config = defineTool({
  name: "update_observability_config",
  domain: "vercel",
  description: "Update the API Observability Plus setting (enabled/disabled) for a project.",
  access: { risk: "write" },
  input: z.object({
    project_id_or_name: z.string(),
    disabled: z.boolean(),
  }),
  execute: async ({ project_id_or_name, disabled }) => {
    const result = await vercel().apiObservability.updateObservabilityConfigurationProject({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { disabled },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── ARTIFACTS (Turborepo remote cache) ────────────────

export const artifacts_status = defineTool({
  name: "artifacts_status",
  domain: "vercel",
  description: "Get the Turborepo remote cache status for the team (enabled? usage?).",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().artifacts.status({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const artifact_exists = defineTool({
  name: "artifact_exists",
  domain: "vercel",
  description: "Check whether a Turborepo artifact with the given hash exists.",
  access: { risk: "read" },
  input: z.object({ hash: z.string() }),
  execute: async ({ hash }) => {
    await vercel().artifacts.artifactExists({ ...TEAM, hash });
    return JSON.stringify({ exists: true, hash });
  },
});

export const artifact_query = defineTool({
  name: "artifact_query",
  domain: "vercel",
  description: "Query Turborepo artifact events and usage statistics by hashes.",
  access: { risk: "read" },
  input: z.object({
    hashes: z.array(z.string()).min(1),
  }),
  execute: async ({ hashes }) => {
    const result = await vercel().artifacts.artifactQuery({
      ...TEAM,
      requestBody: { hashes },
    });
    return JSON.stringify(result);
  },
});
