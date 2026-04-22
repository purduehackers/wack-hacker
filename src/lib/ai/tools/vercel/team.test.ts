import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const teams = {
  getTeam: vi.fn(),
  getTeamMembers: vi.fn(),
  removeTeamMember: vi.fn(),
  deleteTeamInviteCode: vi.fn(),
};
const accessGroups = {
  listAccessGroups: vi.fn(),
  readAccessGroup: vi.fn(),
  deleteAccessGroup: vi.fn(),
  listAccessGroupMembers: vi.fn(),
};
const webhooks = {
  getWebhooks: vi.fn(),
  getWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
};
const projectRoutes = {
  getRoutes: vi.fn(),
  getRouteVersions: vi.fn(),
};
const connect = {
  listNetworks: vi.fn(),
  readNetwork: vi.fn(),
  deleteNetwork: vi.fn(),
};
const microfrontends = {
  getMicrofrontendsGroups: vi.fn(),
};
const billing = {
  listBillingCharges: vi.fn(),
  listContractCommitments: vi.fn(),
};
const environment = {
  getProjectsByIdOrNameCustomEnvironments: vi.fn(),
  getCustomEnvironment: vi.fn(),
  removeCustomEnvironment: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({
    teams,
    accessGroups,
    webhooks,
    projectRoutes,
    connect,
    microfrontends,
    billing,
    environment,
  }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./team.ts");

beforeEach(() => {
  for (const group of [
    teams,
    accessGroups,
    webhooks,
    projectRoutes,
    connect,
    microfrontends,
    billing,
    environment,
  ]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("team", () => {
  it("get team", async () => {
    teams.getTeam.mockResolvedValueOnce({});
    await mod.get_team.execute!({}, toolOpts);
    expect(teams.getTeam).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team_test" }));
  });

  it("members: list + remove + invite code", async () => {
    teams.getTeamMembers.mockResolvedValueOnce({});
    await mod.list_team_members.execute!({ limit: 10 }, toolOpts);

    teams.removeTeamMember.mockResolvedValueOnce({});
    await mod.remove_team_member.execute!({ uid: "u_1" }, toolOpts);

    teams.deleteTeamInviteCode.mockResolvedValueOnce({});
    await mod.delete_team_invite_code.execute!({ inviteId: "i_1" }, toolOpts);
  });
});

describe("access groups", () => {
  it("list / get / delete", async () => {
    accessGroups.listAccessGroups.mockResolvedValueOnce({});
    await mod.list_access_groups.execute!({}, toolOpts);

    accessGroups.readAccessGroup.mockResolvedValueOnce({});
    await mod.get_access_group.execute!({ access_group_id_or_name: "ag_1" }, toolOpts);

    accessGroups.deleteAccessGroup.mockResolvedValueOnce(undefined);
    const raw = await mod.delete_access_group.execute!(
      { access_group_id_or_name: "ag_1" },
      toolOpts,
    );
    expect(JSON.parse(raw as string)).toEqual({ ok: true, id: "ag_1" });
  });

  it("members", async () => {
    accessGroups.listAccessGroupMembers.mockResolvedValueOnce({});
    await mod.list_access_group_members.execute!({ access_group_id_or_name: "ag_1" }, toolOpts);
  });
});

describe("webhooks", () => {
  it("list / get / delete", async () => {
    webhooks.getWebhooks.mockResolvedValueOnce({});
    await mod.list_webhooks.execute!({}, toolOpts);

    webhooks.getWebhook.mockResolvedValueOnce({});
    await mod.get_webhook.execute!({ webhook_id: "w_1" }, toolOpts);

    webhooks.deleteWebhook.mockResolvedValueOnce(undefined);
    await mod.delete_webhook.execute!({ webhook_id: "w_1" }, toolOpts);
  });
});

describe("project routes", () => {
  it("list + versions", async () => {
    projectRoutes.getRoutes.mockResolvedValueOnce({});
    await mod.list_project_routes.execute!({ project_id: "prj_1" }, toolOpts);

    projectRoutes.getRouteVersions.mockResolvedValueOnce({});
    await mod.list_project_route_versions.execute!({ project_id: "prj_1" }, toolOpts);
  });
});

describe("connect networks", () => {
  it("list + get + delete", async () => {
    connect.listNetworks.mockResolvedValueOnce([]);
    await mod.list_connect_networks.execute!({}, toolOpts);

    connect.readNetwork.mockResolvedValueOnce({});
    await mod.get_connect_network.execute!({ network_id: "n_1" }, toolOpts);

    connect.deleteNetwork.mockResolvedValueOnce(undefined);
    await mod.delete_connect_network.execute!({ network_id: "n_1" }, toolOpts);
  });
});

describe("microfrontends", () => {
  it("list groups", async () => {
    microfrontends.getMicrofrontendsGroups.mockResolvedValueOnce({});
    await mod.list_microfrontend_groups.execute!({}, toolOpts);
  });
});

describe("billing", () => {
  it("list charges + commitments", async () => {
    billing.listBillingCharges.mockResolvedValueOnce({});
    await mod.list_billing_charges.execute!(
      { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" },
      toolOpts,
    );

    billing.listContractCommitments.mockResolvedValueOnce({});
    await mod.list_contract_commitments.execute!({}, toolOpts);
  });
});

describe("custom environments", () => {
  it("list + get + remove", async () => {
    environment.getProjectsByIdOrNameCustomEnvironments.mockResolvedValueOnce({});
    await mod.list_custom_environments.execute!({ project_id_or_name: "prj_1" }, toolOpts);

    environment.getCustomEnvironment.mockResolvedValueOnce({});
    await mod.get_custom_environment.execute!(
      { project_id_or_name: "prj_1", environment_id_or_slug: "staging" },
      toolOpts,
    );

    environment.removeCustomEnvironment.mockResolvedValueOnce({});
    await mod.remove_custom_environment.execute!(
      { project_id_or_name: "prj_1", environment_id_or_slug: "staging" },
      toolOpts,
    );
  });
});
