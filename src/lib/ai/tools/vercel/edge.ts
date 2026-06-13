import { z } from "zod";

import { defineTool } from "../_shared/define-tool.ts";
import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

/**
 * Strip the secret `token` field from Edge Config token payloads. The Vercel
 * SDK returns raw tokens on list/get/create; surfacing those into Discord or
 * logs would leak credentials. The SDK's `id` field is explicitly documented
 * as a non-secret reference, so we keep it along with label/createdAt.
 */
function redactTokens<T>(input: T): T {
  if (Array.isArray(input)) return input.map((item) => redactTokens(item)) as unknown as T;
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (key === "token") continue;
      out[key] = redactTokens(val);
    }
    return out as T;
  }
  return input;
}

// ──────────────── EDGE CONFIG — STORES ────────────────

export const list_edge_configs = defineTool({
  name: "list_edge_configs",
  domain: "vercel",
  description: "List every Edge Config store in the team.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().edgeConfig.getEdgeConfigs({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const get_edge_config = defineTool({
  name: "get_edge_config",
  domain: "vercel",
  description: "Retrieve a single Edge Config by id.",
  access: { risk: "read" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfig({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

export const create_edge_config = defineTool({
  name: "create_edge_config",
  domain: "vercel",
  description: "Create a new Edge Config store.",
  access: { risk: "write" },
  input: z.object({
    slug: z.string(),
  }),
  execute: async ({ slug }) => {
    const result = await vercel().edgeConfig.createEdgeConfig({
      ...TEAM,
      requestBody: { slug },
    });
    return JSON.stringify(result);
  },
});

export const update_edge_config = defineTool({
  name: "update_edge_config",
  domain: "vercel",
  description: "Rename an Edge Config.",
  access: { risk: "destructive" },
  input: z.object({
    edge_config_id: z.string(),
    slug: z.string(),
  }),
  execute: async ({ edge_config_id, slug }) => {
    const result = await vercel().edgeConfig.updateEdgeConfig({
      ...TEAM,
      edgeConfigId: edge_config_id,
      requestBody: { slug },
    });
    return JSON.stringify(result);
  },
});

export const delete_edge_config = defineTool({
  name: "delete_edge_config",
  domain: "vercel",
  description: "Permanently delete an Edge Config store.",
  access: { risk: "destructive" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfig({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify({ ok: true, id: edge_config_id });
  },
});

// ──────────────── EDGE CONFIG — ITEMS ────────────────

export const list_edge_config_items = defineTool({
  name: "list_edge_config_items",
  domain: "vercel",
  description: "List all items in an Edge Config.",
  access: { risk: "read" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigItems({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

export const get_edge_config_item = defineTool({
  name: "get_edge_config_item",
  domain: "vercel",
  description: "Get a single item by key from an Edge Config.",
  access: { risk: "read" },
  input: z.object({
    edge_config_id: z.string(),
    key: z.string(),
  }),
  execute: async ({ edge_config_id, key }) => {
    const result = await vercel().edgeConfig.getEdgeConfigItem({
      ...TEAM,
      edgeConfigId: edge_config_id,
      edgeConfigItemKey: key,
    });
    return JSON.stringify(result);
  },
});

export const patch_edge_config_items = defineTool({
  name: "patch_edge_config_items",
  domain: "vercel",
  description:
    "Upsert or delete items in an Edge Config. Pass an array of operations: { operation: 'create'|'update'|'upsert'|'delete', key, value? }.",
  access: { risk: "destructive" },
  input: z.object({
    edge_config_id: z.string(),
    items: z
      .array(
        z.object({
          operation: z.enum(["create", "update", "upsert", "delete"]),
          key: z.string(),
          value: z.unknown().optional(),
        }),
      )
      .min(1),
  }),
  execute: async ({ edge_config_id, items }) => {
    const result = await vercel().edgeConfig.patchEdgeConfigItems({
      ...TEAM,
      edgeConfigId: edge_config_id,
      requestBody: { items },
    });
    return JSON.stringify(result);
  },
});

// ──────────────── EDGE CONFIG — SCHEMA & TOKENS & BACKUPS ────────────────

export const get_edge_config_schema = defineTool({
  name: "get_edge_config_schema",
  domain: "vercel",
  description: "Get the JSON Schema for an Edge Config (validates future writes).",
  access: { risk: "read" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_edge_config_schema = defineTool({
  name: "delete_edge_config_schema",
  domain: "vercel",
  description: "Delete the schema definition on an Edge Config.",
  access: { risk: "destructive" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify({ ok: true });
  },
});

export const list_edge_config_tokens = defineTool({
  name: "list_edge_config_tokens",
  domain: "vercel",
  description:
    "List read tokens for an Edge Config. **Always strips the raw `token` field** — returns id/label/createdAt metadata only. The Vercel dashboard is the only path for retrieving an existing token's secret.",
  access: { risk: "read" },
  input: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigTokens({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(redactTokens(result));
  },
});

export const get_edge_config_token = defineTool({
  name: "get_edge_config_token",
  domain: "vercel",
  description:
    "Retrieve a specific Edge Config read token's metadata. **Strips the raw `token` field** from the response.",
  access: { risk: "read" },
  input: z.object({
    edge_config_id: z.string(),
    token: z.string(),
  }),
  execute: async ({ edge_config_id, token }) => {
    const result = await vercel().edgeConfig.getEdgeConfigToken({
      ...TEAM,
      edgeConfigId: edge_config_id,
      token,
    });
    return JSON.stringify(redactTokens(result));
  },
});

export const create_edge_config_token = defineTool({
  name: "create_edge_config_token",
  domain: "vercel",
  description:
    "Create a new read token for an Edge Config. **Does NOT return the token value** — only its id and label. Retrieve the secret from the Vercel dashboard to avoid leaking it into Discord/logs.",
  access: { risk: "write" },
  input: z.object({
    edge_config_id: z.string(),
    label: z.string(),
  }),
  execute: async ({ edge_config_id, label }) => {
    const result = await vercel().edgeConfig.createEdgeConfigToken({
      ...TEAM,
      edgeConfigId: edge_config_id,
      requestBody: { label },
    });
    const safe = redactTokens(result);
    return JSON.stringify({
      ...safe,
      note: "Token value redacted. Retrieve it from the Vercel dashboard under Edge Config → Tokens.",
    });
  },
});

export const delete_edge_config_tokens = defineTool({
  name: "delete_edge_config_tokens",
  domain: "vercel",
  description: "Delete one or more Edge Config read tokens.",
  access: { risk: "destructive" },
  input: z.object({
    edge_config_id: z.string(),
    tokens: z.array(z.string()).min(1),
  }),
  execute: async ({ edge_config_id, tokens }) => {
    await vercel().edgeConfig.deleteEdgeConfigTokens({
      ...TEAM,
      edgeConfigId: edge_config_id,
      requestBody: { tokens },
    });
    return JSON.stringify({ ok: true, tokens });
  },
});

export const list_edge_config_backups = defineTool({
  name: "list_edge_config_backups",
  domain: "vercel",
  description: "List automatic backups for an Edge Config.",
  access: { risk: "read" },
  input: z.object({
    edge_config_id: z.string(),
    limit: z.number().optional(),
  }),
  execute: async ({ edge_config_id, limit }) => {
    const result = await vercel().edgeConfig.getEdgeConfigBackups({
      ...TEAM,
      edgeConfigId: edge_config_id,
      limit,
    });
    return JSON.stringify(result);
  },
});

export const get_edge_config_backup = defineTool({
  name: "get_edge_config_backup",
  domain: "vercel",
  description: "Retrieve a specific Edge Config backup.",
  access: { risk: "read" },
  input: z.object({
    edge_config_id: z.string(),
    backup_version_id: z.string(),
  }),
  execute: async ({ edge_config_id, backup_version_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigBackup({
      ...TEAM,
      edgeConfigId: edge_config_id,
      edgeConfigBackupVersionId: backup_version_id,
    });
    return JSON.stringify(result);
  },
});

// ──────────────── EDGE CACHE ────────────────

export const invalidate_edge_cache_by_tags = defineTool({
  name: "invalidate_edge_cache_by_tags",
  domain: "vercel",
  description: "Invalidate Vercel Edge Cache entries tagged with any of the given tags.",
  access: { risk: "write" },
  input: z.object({
    project_id_or_name: z.string(),
    tags: z.array(z.string()).min(1),
  }),
  execute: async ({ project_id_or_name, tags }) => {
    await vercel().edgeCache.invalidateByTags({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { tags },
    });
    return JSON.stringify({ ok: true, invalidated: tags });
  },
});

export const dangerously_delete_edge_cache_by_tags = defineTool({
  name: "dangerously_delete_edge_cache_by_tags",
  domain: "vercel",
  description:
    "Forcefully delete (not just invalidate) cache entries by tag. Use invalidate first unless you need storage freed immediately.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    tags: z.array(z.string()).min(1),
  }),
  execute: async ({ project_id_or_name, tags }) => {
    await vercel().edgeCache.dangerouslyDeleteByTags({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { tags },
    });
    return JSON.stringify({ ok: true, deleted: tags });
  },
});

export const invalidate_edge_cache_by_src_images = defineTool({
  name: "invalidate_edge_cache_by_src_images",
  domain: "vercel",
  description: "Invalidate the image optimizer cache for specific source image URLs.",
  access: { risk: "write" },
  input: z.object({
    project_id_or_name: z.string(),
    srcImages: z.array(z.string().url()).min(1),
  }),
  execute: async ({ project_id_or_name, srcImages }) => {
    await vercel().edgeCache.invalidateBySrcImages({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { srcImages },
    });
    return JSON.stringify({ ok: true, invalidated: srcImages });
  },
});

export const dangerously_delete_edge_cache_by_src_images = defineTool({
  name: "dangerously_delete_edge_cache_by_src_images",
  domain: "vercel",
  description: "Forcefully delete image optimizer cache entries for source URLs.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    srcImages: z.array(z.string().url()).min(1),
  }),
  execute: async ({ project_id_or_name, srcImages }) => {
    await vercel().edgeCache.dangerouslyDeleteBySrcImages({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { srcImages },
    });
    return JSON.stringify({ ok: true, deleted: srcImages });
  },
});

// ──────────────── FEATURE FLAGS ────────────────

export const list_flags = defineTool({
  name: "list_flags",
  domain: "vercel",
  description: "List Vercel feature flags for a project.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    limit: z.number().optional(),
  }),
  execute: async ({ project_id_or_name, limit }) => {
    const result = await vercel().featureFlags.listFlags({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      limit,
    });
    return JSON.stringify(result);
  },
});

export const get_flag = defineTool({
  name: "get_flag",
  domain: "vercel",
  description: "Get a feature flag by id.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    flag_id: z.string(),
  }),
  execute: async ({ project_id_or_name, flag_id }) => {
    const result = await vercel().featureFlags.getFlag({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
    });
    return JSON.stringify(result);
  },
});

export const delete_flag = defineTool({
  name: "delete_flag",
  domain: "vercel",
  description: "Permanently delete a feature flag.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    flag_id: z.string(),
  }),
  execute: async ({ project_id_or_name, flag_id }) => {
    await vercel().featureFlags.deleteFlag({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
    });
    return JSON.stringify({ ok: true, id: flag_id });
  },
});

export const list_flag_versions = defineTool({
  name: "list_flag_versions",
  domain: "vercel",
  description: "List historical versions of a feature flag.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    flag_id: z.string(),
    limit: z.number().optional(),
  }),
  execute: async ({ project_id_or_name, flag_id, limit }) => {
    const result = await vercel().featureFlags.listFlagVersions({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      flagIdOrSlug: flag_id,
      limit,
    });
    return JSON.stringify(result);
  },
});

export const get_flag_settings = defineTool({
  name: "get_flag_settings",
  domain: "vercel",
  description: "Get flag settings for a project.",
  access: { risk: "read" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.getFlagSettings({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const list_team_flag_settings = defineTool({
  name: "list_team_flag_settings",
  domain: "vercel",
  description: "List feature-flag settings across every project on the team.",
  access: { risk: "read" },
  input: z.object({}),
  execute: async () => {
    const result = await vercel().featureFlags.listTeamFlagSettings({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const list_team_flags = defineTool({
  name: "list_team_flags",
  domain: "vercel",
  description: "List every feature flag across the team's projects.",
  access: { risk: "read" },
  input: z.object({ limit: z.number().optional() }),
  execute: async ({ limit }) => {
    const result = await vercel().featureFlags.listTeamFlags({ ...TEAM, limit });
    return JSON.stringify(result);
  },
});

export const list_flag_segments = defineTool({
  name: "list_flag_segments",
  domain: "vercel",
  description: "List targeting segments for feature flags on a project.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
  }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.listFlagSegments({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const get_flag_segment = defineTool({
  name: "get_flag_segment",
  domain: "vercel",
  description: "Get a specific flag segment.",
  access: { risk: "read" },
  input: z.object({
    project_id_or_name: z.string(),
    segment_id: z.string(),
    withMetadata: z.boolean().optional(),
  }),
  execute: async ({ project_id_or_name, segment_id, withMetadata }) => {
    const result = await vercel().featureFlags.getFlagSegment({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      segmentIdOrSlug: segment_id,
      withMetadata: withMetadata ?? false,
    });
    return JSON.stringify(result);
  },
});

export const delete_flag_segment = defineTool({
  name: "delete_flag_segment",
  domain: "vercel",
  description: "Delete a targeting segment.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    segment_id: z.string(),
  }),
  execute: async ({ project_id_or_name, segment_id }) => {
    await vercel().featureFlags.deleteFlagSegment({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      segmentIdOrSlug: segment_id,
    });
    return JSON.stringify({ ok: true, id: segment_id });
  },
});

export const get_deployment_feature_flags = defineTool({
  name: "get_deployment_feature_flags",
  domain: "vercel",
  description: "Get the feature flags evaluated during a specific deployment.",
  access: { risk: "read" },
  input: z.object({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().featureFlags.getDeploymentFeatureFlags({
      ...TEAM,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});

export const list_sdk_keys = defineTool({
  name: "list_sdk_keys",
  domain: "vercel",
  description: "List SDK keys for Vercel feature flags on a project.",
  access: { risk: "read" },
  input: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.getSDKKeys({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const create_sdk_key = defineTool({
  name: "create_sdk_key",
  domain: "vercel",
  description: "Create a new feature-flags SDK key for a project.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    sdkKeyType: z.enum(["server", "client"]),
    environment: z.string(),
    label: z.string().optional(),
  }),
  execute: async ({ project_id_or_name, sdkKeyType, environment, label }) => {
    const result = await vercel().featureFlags.createSDKKey({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      requestBody: { sdkKeyType, environment, label },
    });
    return JSON.stringify(result);
  },
});

export const delete_sdk_key = defineTool({
  name: "delete_sdk_key",
  domain: "vercel",
  description: "Delete a feature-flags SDK key.",
  access: { risk: "destructive" },
  input: z.object({
    project_id_or_name: z.string(),
    key_id: z.string(),
  }),
  execute: async ({ project_id_or_name, key_id }) => {
    await vercel().featureFlags.deleteSDKKey({
      ...TEAM,
      projectIdOrName: project_id_or_name,
      hashKey: key_id,
    });
    return JSON.stringify({ ok: true, id: key_id });
  },
});
