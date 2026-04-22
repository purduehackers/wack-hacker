import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const getDeployments = vi.fn();
const getDeployment = vi.fn();
const cancelDeployment = vi.fn();
const deleteDeployment = vi.fn();
const getDeploymentEvents = vi.fn();
const listDeploymentFiles = vi.fn();
const getDeploymentFileContents = vi.fn();
const updateIntegrationDeploymentAction = vi.fn();
const requestPromote = vi.fn();
const requestRollback = vi.fn();
const updateRollbackDescription = vi.fn();

vi.mock("./client.ts", () => ({
  vercel: () => ({
    deployments: {
      getDeployments,
      getDeployment,
      cancelDeployment,
      deleteDeployment,
      getDeploymentEvents,
      listDeploymentFiles,
      getDeploymentFileContents,
      updateIntegrationDeploymentAction,
    },
    projects: {
      requestPromote,
      requestRollback,
      updateProjectsByProjectIdRollbackByDeploymentIdUpdateDescription: updateRollbackDescription,
    },
  }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./deployments.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("list_deployments", () => {
  it("forwards filters and team scoping", async () => {
    getDeployments.mockResolvedValueOnce({ deployments: [] });
    await mod.list_deployments.execute!(
      { projectId: "prj_1", target: "production", state: "READY", limit: 10 },
      toolOpts,
    );
    expect(getDeployments).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team_test",
        projectId: "prj_1",
        target: "production",
        state: "READY",
        limit: 10,
      }),
    );
  });
});

describe("get_deployment", () => {
  it("passes idOrUrl", async () => {
    getDeployment.mockResolvedValueOnce({ id: "dpl_1" });
    await mod.get_deployment.execute!({ id_or_url: "dpl_1" }, toolOpts);
    expect(getDeployment).toHaveBeenCalledWith(expect.objectContaining({ idOrUrl: "dpl_1" }));
  });
});

describe("get_deployment_events", () => {
  it("caps limit at 200", async () => {
    getDeploymentEvents.mockResolvedValueOnce([]);
    await mod.get_deployment_events.execute!({ deployment_id: "dpl_1", limit: 9999 }, toolOpts);
    expect(getDeploymentEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it("defaults to 200 when unspecified", async () => {
    getDeploymentEvents.mockResolvedValueOnce([]);
    await mod.get_deployment_events.execute!({ deployment_id: "dpl_1" }, toolOpts);
    expect(getDeploymentEvents).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
  });
});

describe("cancel_deployment / delete_deployment", () => {
  it("cancel", async () => {
    cancelDeployment.mockResolvedValueOnce({ state: "CANCELED" });
    await mod.cancel_deployment.execute!({ deployment_id: "dpl_1" }, toolOpts);
    expect(cancelDeployment).toHaveBeenCalledWith(expect.objectContaining({ id: "dpl_1" }));
  });

  it("delete", async () => {
    deleteDeployment.mockResolvedValueOnce({});
    await mod.delete_deployment.execute!({ id_or_url: "dpl_1" }, toolOpts);
    expect(deleteDeployment).toHaveBeenCalledWith(expect.objectContaining({ id: "dpl_1" }));
  });
});

describe("promote_deployment / rollback_deployment", () => {
  it("promote", async () => {
    requestPromote.mockResolvedValueOnce(undefined);
    const raw = await mod.promote_deployment.execute!(
      { project_id: "prj_1", deployment_id: "dpl_1" },
      toolOpts,
    );
    expect(requestPromote).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", deploymentId: "dpl_1" }),
    );
    expect(JSON.parse(raw as string).ok).toBe(true);
  });

  it("rollback", async () => {
    requestRollback.mockResolvedValueOnce(undefined);
    await mod.rollback_deployment.execute!(
      { project_id: "prj_1", deployment_id: "dpl_1" },
      toolOpts,
    );
    expect(requestRollback).toHaveBeenCalled();
  });

  it("update_rollback_description", async () => {
    updateRollbackDescription.mockResolvedValueOnce(undefined);
    await mod.update_rollback_description.execute!(
      { project_id: "prj_1", deployment_id: "dpl_1", description: "bad build" },
      toolOpts,
    );
    expect(updateRollbackDescription).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "prj_1",
        deploymentId: "dpl_1",
        requestBody: { description: "bad build" },
      }),
    );
  });
});

describe("list_deployment_files / get_deployment_file_contents", () => {
  it("list files", async () => {
    listDeploymentFiles.mockResolvedValueOnce([]);
    await mod.list_deployment_files.execute!({ deployment_id: "dpl_1" }, toolOpts);
    expect(listDeploymentFiles).toHaveBeenCalledWith(expect.objectContaining({ id: "dpl_1" }));
  });

  it("get file contents", async () => {
    getDeploymentFileContents.mockResolvedValueOnce(undefined);
    await mod.get_deployment_file_contents.execute!(
      { deployment_id: "dpl_1", file_id: "f_1" },
      toolOpts,
    );
    expect(getDeploymentFileContents).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dpl_1", fileId: "f_1" }),
    );
  });
});

describe("update_integration_deployment_action", () => {
  it("passes ids + action", async () => {
    updateIntegrationDeploymentAction.mockResolvedValueOnce(undefined);
    await mod.update_integration_deployment_action.execute!(
      {
        deployment_id: "dpl_1",
        integrationConfigurationId: "ic_1",
        resourceId: "r_1",
        action: "approve",
      },
      toolOpts,
    );
    expect(updateIntegrationDeploymentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        deploymentId: "dpl_1",
        integrationConfigurationId: "ic_1",
        resourceId: "r_1",
        action: "approve",
      }),
    );
  });
});
