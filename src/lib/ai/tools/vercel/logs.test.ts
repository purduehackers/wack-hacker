import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const logs = { getRuntimeLogs: vi.fn() };
const logDrains = {
  getAllLogDrains: vi.fn(),
  getConfigurableLogDrain: vi.fn(),
  deleteConfigurableLogDrain: vi.fn(),
  getIntegrationLogDrains: vi.fn(),
  deleteIntegrationLogDrain: vi.fn(),
};
const drains = {
  getDrains: vi.fn(),
  getDrain: vi.fn(),
  deleteDrain: vi.fn(),
};
const apiObservability = {
  getObservabilityConfigurationProjects: vi.fn(),
  updateObservabilityConfigurationProject: vi.fn(),
};
const artifacts = {
  status: vi.fn(),
  artifactExists: vi.fn(),
  artifactQuery: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ logs, logDrains, drains, apiObservability, artifacts }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./logs.ts");

beforeEach(() => {
  for (const group of [logs, logDrains, drains, apiObservability, artifacts]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("runtime logs", () => {
  it("passes projectId + deploymentId", async () => {
    logs.getRuntimeLogs.mockResolvedValueOnce({ logs: [] });
    await mod.get_runtime_logs.execute!({ project_id: "prj_1", deployment_id: "dpl_1" }, toolOpts);
    expect(logs.getRuntimeLogs).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", deploymentId: "dpl_1" }),
    );
  });
});

describe("log drains", () => {
  it("list / get / delete configurable", async () => {
    logDrains.getAllLogDrains.mockResolvedValueOnce([]);
    await mod.list_log_drains.execute!({}, toolOpts);

    logDrains.getConfigurableLogDrain.mockResolvedValueOnce({ id: "d_1" });
    await mod.get_log_drain.execute!({ drain_id: "d_1" }, toolOpts);

    logDrains.deleteConfigurableLogDrain.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_configurable_log_drain.execute!({ drain_id: "d_1" }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "d_1" });
  });

  it("integration drains", async () => {
    logDrains.getIntegrationLogDrains.mockResolvedValueOnce([]);
    await mod.list_integration_log_drains.execute!({}, toolOpts);

    logDrains.deleteIntegrationLogDrain.mockResolvedValueOnce(undefined);
    await mod.delete_integration_log_drain.execute!({ drain_id: "d_1" }, toolOpts);
  });
});

describe("drains", () => {
  it("list / get / delete", async () => {
    drains.getDrains.mockResolvedValueOnce({ drains: [] });
    await mod.list_drains.execute!({}, toolOpts);

    drains.getDrain.mockResolvedValueOnce({});
    await mod.get_drain.execute!({ drain_id: "dr_1" }, toolOpts);

    drains.deleteDrain.mockResolvedValueOnce(undefined);
    await mod.delete_drain.execute!({ drain_id: "dr_1" }, toolOpts);
  });
});

describe("observability", () => {
  it("get / update", async () => {
    apiObservability.getObservabilityConfigurationProjects.mockResolvedValueOnce({});
    await mod.get_observability_config.execute!({}, toolOpts);

    apiObservability.updateObservabilityConfigurationProject.mockResolvedValueOnce({});
    await mod.update_observability_config.execute!(
      { project_id_or_name: "prj_1", disabled: true },
      toolOpts,
    );
    expect(apiObservability.updateObservabilityConfigurationProject).toHaveBeenCalledWith(
      expect.objectContaining({
        projectIdOrName: "prj_1",
        requestBody: { disabled: true },
      }),
    );
  });
});

describe("artifacts", () => {
  it("status / exists / query", async () => {
    artifacts.status.mockResolvedValueOnce({});
    await mod.artifacts_status.execute!({}, toolOpts);

    artifacts.artifactExists.mockResolvedValueOnce(undefined);
    const raw = await mod.artifact_exists.execute!({ hash: "abc" }, toolOpts);
    expect(JSON.parse(raw as string)).toEqual({ exists: true, hash: "abc" });

    artifacts.artifactQuery.mockResolvedValueOnce({});
    await mod.artifact_query.execute!({ hashes: ["a", "b"] }, toolOpts);
    expect(artifacts.artifactQuery).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: { hashes: ["a", "b"] } }),
    );
  });
});
