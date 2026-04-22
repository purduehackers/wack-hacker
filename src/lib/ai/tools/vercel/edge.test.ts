import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const edgeConfig = {
  getEdgeConfigs: vi.fn(),
  getEdgeConfig: vi.fn(),
  createEdgeConfig: vi.fn(),
  updateEdgeConfig: vi.fn(),
  deleteEdgeConfig: vi.fn(),
  getEdgeConfigItems: vi.fn(),
  getEdgeConfigItem: vi.fn(),
  patchEdgeConfigItems: vi.fn(),
  getEdgeConfigSchema: vi.fn(),
  deleteEdgeConfigSchema: vi.fn(),
  getEdgeConfigTokens: vi.fn(),
  getEdgeConfigToken: vi.fn(),
  createEdgeConfigToken: vi.fn(),
  deleteEdgeConfigTokens: vi.fn(),
  getEdgeConfigBackups: vi.fn(),
  getEdgeConfigBackup: vi.fn(),
};
const edgeCache = {
  invalidateByTags: vi.fn(),
  dangerouslyDeleteByTags: vi.fn(),
  invalidateBySrcImages: vi.fn(),
  dangerouslyDeleteBySrcImages: vi.fn(),
};
const featureFlags = {
  listFlags: vi.fn(),
  getFlag: vi.fn(),
  deleteFlag: vi.fn(),
  listFlagVersions: vi.fn(),
  getFlagSettings: vi.fn(),
  listTeamFlagSettings: vi.fn(),
  listTeamFlags: vi.fn(),
  listFlagSegments: vi.fn(),
  getFlagSegment: vi.fn(),
  deleteFlagSegment: vi.fn(),
  getDeploymentFeatureFlags: vi.fn(),
  getSDKKeys: vi.fn(),
  createSDKKey: vi.fn(),
  deleteSDKKey: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ edgeConfig, edgeCache, featureFlags }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./edge.ts");

beforeEach(() => {
  for (const group of [edgeConfig, edgeCache, featureFlags]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("edge config stores", () => {
  it("list / get / create / update / delete", async () => {
    edgeConfig.getEdgeConfigs.mockResolvedValueOnce([]);
    await mod.list_edge_configs.execute!({}, toolOpts);

    edgeConfig.getEdgeConfig.mockResolvedValueOnce({});
    await mod.get_edge_config.execute!({ edge_config_id: "ec_1" }, toolOpts);

    edgeConfig.createEdgeConfig.mockResolvedValueOnce({});
    await mod.create_edge_config.execute!({ slug: "test" }, toolOpts);

    edgeConfig.updateEdgeConfig.mockResolvedValueOnce({});
    await mod.update_edge_config.execute!({ edge_config_id: "ec_1", slug: "new" }, toolOpts);

    edgeConfig.deleteEdgeConfig.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_edge_config.execute!({ edge_config_id: "ec_1" }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "ec_1" });
  });

  it("items", async () => {
    edgeConfig.getEdgeConfigItems.mockResolvedValueOnce([]);
    await mod.list_edge_config_items.execute!({ edge_config_id: "ec_1" }, toolOpts);

    edgeConfig.getEdgeConfigItem.mockResolvedValueOnce({});
    await mod.get_edge_config_item.execute!({ edge_config_id: "ec_1", key: "flag" }, toolOpts);

    edgeConfig.patchEdgeConfigItems.mockResolvedValueOnce({});
    await mod.patch_edge_config_items.execute!(
      {
        edge_config_id: "ec_1",
        items: [{ operation: "upsert", key: "k", value: "v" }],
      },
      toolOpts,
    );
    expect(edgeConfig.patchEdgeConfigItems).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { items: [{ operation: "upsert", key: "k", value: "v" }] },
      }),
    );
  });

  it("tokens", async () => {
    edgeConfig.createEdgeConfigToken.mockResolvedValueOnce({ token: "t" });
    await mod.create_edge_config_token.execute!(
      { edge_config_id: "ec_1", label: "reader" },
      toolOpts,
    );
    expect(edgeConfig.createEdgeConfigToken).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { label: "reader" } }),
    );

    edgeConfig.deleteEdgeConfigTokens.mockResolvedValueOnce(undefined);
    await mod.delete_edge_config_tokens.execute!(
      { edge_config_id: "ec_1", tokens: ["t1"] },
      toolOpts,
    );
  });
});

describe("edge cache", () => {
  it("invalidate by tags", async () => {
    edgeCache.invalidateByTags.mockResolvedValueOnce(undefined);
    const raw = await mod.invalidate_edge_cache_by_tags.execute!(
      { project_id_or_name: "prj_1", tags: ["home", "nav"] },
      toolOpts,
    );
    expect(edgeCache.invalidateByTags).toHaveBeenCalledWith(
      expect.objectContaining({
        projectIdOrName: "prj_1",
        requestBody: { tags: ["home", "nav"] },
      }),
    );
    expect(JSON.parse(raw as string).invalidated).toEqual(["home", "nav"]);
  });

  it("invalidate by src images", async () => {
    edgeCache.invalidateBySrcImages.mockResolvedValueOnce(undefined);
    await mod.invalidate_edge_cache_by_src_images.execute!(
      { project_id_or_name: "prj_1", srcImages: ["https://x/y.jpg"] },
      toolOpts,
    );
    expect(edgeCache.invalidateBySrcImages).toHaveBeenCalled();
  });
});

describe("feature flags", () => {
  it("list + get + delete", async () => {
    featureFlags.listFlags.mockResolvedValueOnce({ flags: [] });
    await mod.list_flags.execute!({ project_id_or_name: "prj_1" }, toolOpts);

    featureFlags.getFlag.mockResolvedValueOnce({});
    await mod.get_flag.execute!({ project_id_or_name: "prj_1", flag_id: "f_1" }, toolOpts);

    featureFlags.deleteFlag.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_flag.execute!(
      { project_id_or_name: "prj_1", flag_id: "f_1" },
      toolOpts,
    );
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "f_1" });
  });

  it("segments", async () => {
    featureFlags.deleteFlagSegment.mockResolvedValueOnce(undefined);
    await mod.delete_flag_segment.execute!(
      { project_id_or_name: "prj_1", segment_id: "s_1" },
      toolOpts,
    );
  });

  it("sdk keys", async () => {
    featureFlags.createSDKKey.mockResolvedValueOnce({});
    await mod.create_sdk_key.execute!(
      { project_id_or_name: "prj_1", sdkKeyType: "server", environment: "production" },
      toolOpts,
    );
    expect(featureFlags.createSDKKey).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ sdkKeyType: "server" }),
      }),
    );

    featureFlags.deleteSDKKey.mockResolvedValueOnce(undefined);
    await mod.delete_sdk_key.execute!({ project_id_or_name: "prj_1", key_id: "k_1" }, toolOpts);
  });
});
