import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const integrations = {
  getConfigurations: vi.fn(),
  getConfiguration: vi.fn(),
  getConfigurationProducts: vi.fn(),
  getBillingPlans: vi.fn(),
  deleteConfiguration: vi.fn(),
  createIntegrationStoreDirect: vi.fn(),
  connectIntegrationResourceToProject: vi.fn(),
  gitNamespaces: vi.fn(),
  searchRepo: vi.fn(),
};
const marketplace = {
  getIntegrationResources: vi.fn(),
  getIntegrationResource: vi.fn(),
  deleteIntegrationResource: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ integrations, marketplace }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./integrations.ts");

beforeEach(() => {
  for (const group of [integrations, marketplace]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("integration configurations", () => {
  it("list / get / products", async () => {
    integrations.getConfigurations.mockResolvedValueOnce({ configurations: [] });
    await mod.list_integration_configurations.execute!({ view: "account" }, toolOpts);
    expect(integrations.getConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({ view: "account" }),
    );

    integrations.getConfiguration.mockResolvedValueOnce({});
    await mod.get_integration_configuration.execute!({ configuration_id: "ic_1" }, toolOpts);

    integrations.getConfigurationProducts.mockResolvedValueOnce({});
    await mod.get_integration_configuration_products.execute!(
      { configuration_id: "ic_1" },
      toolOpts,
    );
    expect(integrations.getConfigurationProducts).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ic_1" }),
    );
  });

  it("billing plans", async () => {
    integrations.getBillingPlans.mockResolvedValueOnce({});
    await mod.get_integration_billing_plans.execute!(
      { integration_id_or_slug: "turso", product_id_or_slug: "database" },
      toolOpts,
    );
    expect(integrations.getBillingPlans).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationIdOrSlug: "turso",
        productIdOrSlug: "database",
      }),
    );
  });

  it("delete configuration", async () => {
    integrations.deleteConfiguration.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_integration_configuration.execute!(
      { configuration_id: "ic_1" },
      toolOpts,
    );
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "ic_1" });
  });
});

describe("provisioning flow", () => {
  it("create_integration_store_direct (the headline feature)", async () => {
    integrations.createIntegrationStoreDirect.mockResolvedValueOnce({
      store: { id: "res_1", name: "wack-turso" },
    });
    await mod.create_integration_store_direct.execute!(
      {
        integration_configuration_id: "ic_turso",
        integration_product_id_or_slug: "database",
        name: "wack-turso",
      },
      toolOpts,
    );
    expect(integrations.createIntegrationStoreDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          name: "wack-turso",
          integrationConfigurationId: "ic_turso",
          integrationProductIdOrSlug: "database",
        }),
      }),
    );
  });

  it("connect_integration_resource_to_project", async () => {
    integrations.connectIntegrationResourceToProject.mockResolvedValueOnce(undefined);
    const raw = await mod.connect_integration_resource_to_project.execute!(
      {
        integration_configuration_id: "ic_turso",
        resource_id: "res_1",
        project_id: "prj_1",
      },
      toolOpts,
    );
    expect(integrations.connectIntegrationResourceToProject).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationConfigurationId: "ic_turso",
        resourceId: "res_1",
        requestBody: { projectId: "prj_1" },
      }),
    );
    const parsed = JSON.parse(raw as string);
    expect(parsed.resourceId).toBe("res_1");
  });
});

describe("marketplace resources", () => {
  it("list / get", async () => {
    marketplace.getIntegrationResources.mockResolvedValueOnce({});
    await mod.list_integration_resources.execute!({ configuration_id: "ic_1" }, toolOpts);

    marketplace.getIntegrationResource.mockResolvedValueOnce({});
    await mod.get_integration_resource.execute!(
      { configuration_id: "ic_1", resource_id: "res_1" },
      toolOpts,
    );
  });

  it("delete resource", async () => {
    marketplace.deleteIntegrationResource.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_integration_resource.execute!(
      { configuration_id: "ic_1", resource_id: "res_1" },
      toolOpts,
    );
    expect(JSON.parse(raw as string)).toEqual({ ok: true, resourceId: "res_1" });
  });
});

describe("git search", () => {
  it("namespaces", async () => {
    integrations.gitNamespaces.mockResolvedValueOnce([]);
    await mod.list_git_namespaces.execute!({ provider: "github" }, toolOpts);
    expect(integrations.gitNamespaces).toHaveBeenCalled();
  });

  it("search repos", async () => {
    integrations.searchRepo.mockResolvedValueOnce({ gitAccount: {}, repos: [] });
    await mod.search_git_repos.execute!({ provider: "github", query: "wack" }, toolOpts);
    expect(integrations.searchRepo).toHaveBeenCalledWith(
      expect.objectContaining({ query: "wack" }),
    );
  });
});
