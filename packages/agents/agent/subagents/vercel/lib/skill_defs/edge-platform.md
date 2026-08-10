---
description: Global Config stores/items/tokens/backups, edge cache invalidation, native Vercel feature flags.
---

## When to use

Use when the user asks about Global Config, cache invalidation (by tag or image URL), or Vercel's native feature flags and SDK keys.

## Relevant tools

`list_global_configs`, `get_global_config`, `create_global_config`, `update_global_config`, `delete_global_config`, `list_global_config_items`, `get_global_config_item`, `patch_global_config_items`, `get_global_config_schema`, `delete_global_config_schema`, `list_global_config_tokens`, `get_global_config_token`, `create_global_config_token`, `delete_global_config_tokens`, `list_global_config_backups`, `get_global_config_backup`, `invalidate_edge_cache_by_tags`, `dangerously_delete_edge_cache_by_tags`, `invalidate_edge_cache_by_src_images`, `dangerously_delete_edge_cache_by_src_images`, `list_flags`, `get_flag`, `delete_flag`, `list_flag_versions`, `get_flag_settings`, `list_team_flag_settings`, `list_team_flags`, `list_flag_segments`, `get_flag_segment`, `delete_flag_segment`, `get_deployment_feature_flags`, `list_sdk_keys`, `create_sdk_key`, `delete_sdk_key`

## Instructions

<global-config>
- `patch_global_config_items` batches upsert/update/delete ops. Preferred over individual writes.
- Deleting a token breaks any client that was using it — confirm before running.
</global-config>

<edge-cache>
- Prefer `invalidate_*` tools over `dangerously_delete_*`: invalidate is faster and cheaper.
- Use `dangerously_delete_*` only when you need storage freed immediately.
</edge-cache>

<feature-flags>
- `create_flag` and `update_flag` are omitted from this subagent because their request bodies have deep nested variant configs that don't translate cleanly. Direct the user to the Vercel dashboard for those.
- `delete_sdk_key` takes the SDK key's hash (aliased as `key_id` in this tool) — clients using that key will break.
</feature-flags>
