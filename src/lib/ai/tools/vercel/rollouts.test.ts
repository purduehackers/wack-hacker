import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const rollingRelease = {
  getRollingRelease: vi.fn(),
  getRollingReleaseConfig: vi.fn(),
  getRollingReleaseBillingStatus: vi.fn(),
  deleteRollingReleaseConfig: vi.fn(),
  approveRollingReleaseStage: vi.fn(),
  completeRollingRelease: vi.fn(),
};
const checksV2 = {
  listProjectChecks: vi.fn(),
  getProjectCheck: vi.fn(),
  deleteProjectCheck: vi.fn(),
  listCheckRuns: vi.fn(),
  listDeploymentCheckRuns: vi.fn(),
  getDeploymentCheckRun: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ rollingRelease, checksV2 }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./rollouts.ts");

beforeEach(() => {
  for (const group of [rollingRelease, checksV2]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("rolling releases", () => {
  it("read + delete", async () => {
    rollingRelease.getRollingRelease.mockResolvedValueOnce({});
    await mod.get_rolling_release.execute!({ project_id_or_name: "prj_1" }, toolOpts);

    rollingRelease.getRollingReleaseConfig.mockResolvedValueOnce({});
    await mod.get_rolling_release_config.execute!({ project_id_or_name: "prj_1" }, toolOpts);

    rollingRelease.getRollingReleaseBillingStatus.mockResolvedValueOnce({});
    await mod.get_rolling_release_billing_status.execute!(
      { project_id_or_name: "prj_1" },
      toolOpts,
    );

    rollingRelease.deleteRollingReleaseConfig.mockResolvedValueOnce({});
    await mod.delete_rolling_release_config.execute!({ project_id_or_name: "prj_1" }, toolOpts);
  });

  it("approve stage + complete", async () => {
    rollingRelease.approveRollingReleaseStage.mockResolvedValueOnce({});
    await mod.approve_rolling_release_stage.execute!(
      { project_id_or_name: "prj_1", canaryDeploymentId: "dpl_1", nextStageIndex: 1 },
      toolOpts,
    );
    expect(rollingRelease.approveRollingReleaseStage).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { canaryDeploymentId: "dpl_1", nextStageIndex: 1 },
      }),
    );

    rollingRelease.completeRollingRelease.mockResolvedValueOnce({});
    await mod.complete_rolling_release.execute!(
      { project_id_or_name: "prj_1", canaryDeploymentId: "dpl_1" },
      toolOpts,
    );
  });
});

describe("checks", () => {
  it("list / get / delete project checks", async () => {
    checksV2.listProjectChecks.mockResolvedValueOnce({});
    await mod.list_project_checks.execute!({ project_id_or_name: "prj_1" }, toolOpts);

    checksV2.getProjectCheck.mockResolvedValueOnce({});
    await mod.get_project_check.execute!(
      { project_id_or_name: "prj_1", check_id: "chk_1" },
      toolOpts,
    );

    checksV2.deleteProjectCheck.mockResolvedValueOnce({});
    await mod.delete_project_check.execute!(
      { project_id_or_name: "prj_1", check_id: "chk_1" },
      toolOpts,
    );
  });

  it("check runs", async () => {
    checksV2.listCheckRuns.mockResolvedValueOnce({});
    await mod.list_check_runs.execute!(
      { project_id_or_name: "prj_1", check_id: "chk_1" },
      toolOpts,
    );

    checksV2.listDeploymentCheckRuns.mockResolvedValueOnce({});
    await mod.list_deployment_check_runs.execute!({ deployment_id: "dpl_1" }, toolOpts);

    checksV2.getDeploymentCheckRun.mockResolvedValueOnce({});
    await mod.get_deployment_check_run.execute!(
      { deployment_id: "dpl_1", check_run_id: "run_1" },
      toolOpts,
    );
  });
});
