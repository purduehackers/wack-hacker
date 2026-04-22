import { tool } from "ai";
import { z } from "zod";

import { vercel } from "./client.ts";
import { VERCEL_TEAM_ID, VERCEL_TEAM_SLUG } from "./constants.ts";

const TEAM = { teamId: VERCEL_TEAM_ID, slug: VERCEL_TEAM_SLUG } as const;

// ──────────────── EDGE CONFIG — STORES ────────────────

export const list_edge_configs = tool({
  description: "List every Edge Config store in the team.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().edgeConfig.getEdgeConfigs({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const get_edge_config = tool({
  description: "Retrieve a single Edge Config by id.",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfig({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Creates a new Edge Config store. */
export const create_edge_config = tool({
  description: "Create a new Edge Config store.",
  inputSchema: z.object({
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

/** @destructive Renames an Edge Config. */
export const update_edge_config = tool({
  description: "Rename an Edge Config.",
  inputSchema: z.object({
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

/** @destructive Permanently deletes an Edge Config store. */
export const delete_edge_config = tool({
  description: "Permanently delete an Edge Config store.",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfig({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify({ ok: true, id: edge_config_id });
  },
});

// ──────────────── EDGE CONFIG — ITEMS ────────────────

export const list_edge_config_items = tool({
  description: "List all items in an Edge Config.",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigItems({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

export const get_edge_config_item = tool({
  description: "Get a single item by key from an Edge Config.",
  inputSchema: z.object({
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

/** @destructive Writes/deletes keys in an Edge Config — changes live config. */
export const patch_edge_config_items = tool({
  description:
    "Upsert or delete items in an Edge Config. Pass an array of operations: { operation: 'create'|'update'|'upsert'|'delete', key, value? }.",
  inputSchema: z.object({
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

export const get_edge_config_schema = tool({
  description: "Get the JSON Schema for an Edge Config (validates future writes).",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Removes the schema from an Edge Config. */
export const delete_edge_config_schema = tool({
  description: "Delete the schema definition on an Edge Config.",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    await vercel().edgeConfig.deleteEdgeConfigSchema({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify({ ok: true });
  },
});

export const list_edge_config_tokens = tool({
  description: "List read tokens for an Edge Config.",
  inputSchema: z.object({ edge_config_id: z.string() }),
  execute: async ({ edge_config_id }) => {
    const result = await vercel().edgeConfig.getEdgeConfigTokens({
      ...TEAM,
      edgeConfigId: edge_config_id,
    });
    return JSON.stringify(result);
  },
});

export const get_edge_config_token = tool({
  description: "Retrieve a specific Edge Config read token.",
  inputSchema: z.object({
    edge_config_id: z.string(),
    token: z.string(),
  }),
  execute: async ({ edge_config_id, token }) => {
    const result = await vercel().edgeConfig.getEdgeConfigToken({
      ...TEAM,
      edgeConfigId: edge_config_id,
      token,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Creates a new read token for an Edge Config. */
export const create_edge_config_token = tool({
  description: "Create a new read token for an Edge Config.",
  inputSchema: z.object({
    edge_config_id: z.string(),
    label: z.string(),
  }),
  execute: async ({ edge_config_id, label }) => {
    const result = await vercel().edgeConfig.createEdgeConfigToken({
      ...TEAM,
      edgeConfigId: edge_config_id,
      requestBody: { label },
    });
    return JSON.stringify(result);
  },
});

/** @destructive Deletes Edge Config tokens — consumers using them break. */
export const delete_edge_config_tokens = tool({
  description: "Delete one or more Edge Config read tokens.",
  inputSchema: z.object({
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

export const list_edge_config_backups = tool({
  description: "List automatic backups for an Edge Config.",
  inputSchema: z.object({
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

export const get_edge_config_backup = tool({
  description: "Retrieve a specific Edge Config backup.",
  inputSchema: z.object({
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

/** @destructive Invalidates cache entries by tag. Briefly raises origin load. */
export const invalidate_edge_cache_by_tags = tool({
  description: "Invalidate Vercel Edge Cache entries tagged with any of the given tags.",
  inputSchema: z.object({
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

/** @destructive Deletes cache entries by tag — harder than invalidate. */
export const dangerously_delete_edge_cache_by_tags = tool({
  description:
    "Forcefully delete (not just invalidate) cache entries by tag. Use invalidate first unless you need storage freed immediately.",
  inputSchema: z.object({
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

/** @destructive Invalidates image optimizer cache for specific source URLs. */
export const invalidate_edge_cache_by_src_images = tool({
  description: "Invalidate the image optimizer cache for specific source image URLs.",
  inputSchema: z.object({
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

/** @destructive Deletes image cache entries by source URL. */
export const dangerously_delete_edge_cache_by_src_images = tool({
  description: "Forcefully delete image optimizer cache entries for source URLs.",
  inputSchema: z.object({
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

export const list_flags = tool({
  description: "List Vercel feature flags for a project.",
  inputSchema: z.object({
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

export const get_flag = tool({
  description: "Get a feature flag by id.",
  inputSchema: z.object({
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

/** @destructive Deletes a feature flag. */
export const delete_flag = tool({
  description: "Permanently delete a feature flag.",
  inputSchema: z.object({
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

export const list_flag_versions = tool({
  description: "List historical versions of a feature flag.",
  inputSchema: z.object({
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

export const get_flag_settings = tool({
  description: "Get flag settings for a project.",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.getFlagSettings({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

export const list_team_flag_settings = tool({
  description: "List feature-flag settings across every project on the team.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = await vercel().featureFlags.listTeamFlagSettings({ ...TEAM });
    return JSON.stringify(result);
  },
});

export const list_team_flags = tool({
  description: "List every feature flag across the team's projects.",
  inputSchema: z.object({ limit: z.number().optional() }),
  execute: async ({ limit }) => {
    const result = await vercel().featureFlags.listTeamFlags({ ...TEAM, limit });
    return JSON.stringify(result);
  },
});

export const list_flag_segments = tool({
  description: "List targeting segments for feature flags on a project.",
  inputSchema: z.object({
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

export const get_flag_segment = tool({
  description: "Get a specific flag segment.",
  inputSchema: z.object({
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

/** @destructive Deletes a targeting segment. */
export const delete_flag_segment = tool({
  description: "Delete a targeting segment.",
  inputSchema: z.object({
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

export const get_deployment_feature_flags = tool({
  description: "Get the feature flags evaluated during a specific deployment.",
  inputSchema: z.object({ deployment_id: z.string() }),
  execute: async ({ deployment_id }) => {
    const result = await vercel().featureFlags.getDeploymentFeatureFlags({
      ...TEAM,
      deploymentId: deployment_id,
    });
    return JSON.stringify(result);
  },
});

export const list_sdk_keys = tool({
  description: "List SDK keys for Vercel feature flags on a project.",
  inputSchema: z.object({ project_id_or_name: z.string() }),
  execute: async ({ project_id_or_name }) => {
    const result = await vercel().featureFlags.getSDKKeys({
      ...TEAM,
      projectIdOrName: project_id_or_name,
    });
    return JSON.stringify(result);
  },
});

/** @destructive Creates a new SDK key — grants clients programmatic access to flags. */
export const create_sdk_key = tool({
  description: "Create a new feature-flags SDK key for a project.",
  inputSchema: z.object({
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

/** @destructive Deletes an SDK key — clients using it break. */
export const delete_sdk_key = tool({
  description: "Delete a feature-flags SDK key.",
  inputSchema: z.object({
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
