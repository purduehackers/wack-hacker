import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const security = {
  getFirewallConfig: vi.fn(),
  getActiveAttackStatus: vi.fn(),
  updateAttackChallengeMode: vi.fn(),
  getBypassIp: vi.fn(),
  getSecurityFirewallEvents: vi.fn(),
};
const authentication = {
  listAuthTokens: vi.fn(),
  getAuthToken: vi.fn(),
  deleteAuthToken: vi.fn(),
};

vi.mock("./client.ts", () => ({
  vercel: () => ({ security, authentication }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const mod = await import("./security.ts");

beforeEach(() => {
  for (const group of [security, authentication]) {
    for (const fn of Object.values(group)) fn.mockReset();
  }
});

describe("firewall", () => {
  it("get config", async () => {
    security.getFirewallConfig.mockResolvedValueOnce({});
    await mod.get_firewall_config.execute!(
      { project_id: "prj_1", configVersion: "active" },
      toolOpts,
    );
    expect(security.getFirewallConfig).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", configVersion: "active" }),
    );
  });
});

describe("attack mode", () => {
  it("get status + toggle", async () => {
    security.getActiveAttackStatus.mockResolvedValueOnce({});
    await mod.get_active_attack_status.execute!({ project_id: "prj_1" }, toolOpts);

    security.updateAttackChallengeMode.mockResolvedValueOnce({});
    await mod.update_attack_challenge_mode.execute!(
      { project_id: "prj_1", attackModeEnabled: true },
      toolOpts,
    );
    expect(security.updateAttackChallengeMode).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ attackModeEnabled: true }),
      }),
    );
  });
});

describe("bypass IPs", () => {
  it("list", async () => {
    security.getBypassIp.mockResolvedValueOnce({});
    await mod.list_bypass_ips.execute!({ project_id: "prj_1" }, toolOpts);
    expect(security.getBypassIp).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1" }),
    );
  });
});

describe("firewall events", () => {
  it("list", async () => {
    security.getSecurityFirewallEvents.mockResolvedValueOnce({});
    await mod.list_firewall_events.execute!({ projectId: "prj_1", limit: 10 }, toolOpts);
    expect(security.getSecurityFirewallEvents).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "prj_1", limit: 10 }),
    );
  });
});

describe("auth tokens", () => {
  it("list + get + delete", async () => {
    authentication.listAuthTokens.mockResolvedValueOnce({});
    await mod.list_auth_tokens.execute!({}, toolOpts);

    authentication.getAuthToken.mockResolvedValueOnce({});
    await mod.get_auth_token.execute!({ token_id: "t_1" }, toolOpts);

    authentication.deleteAuthToken.mockResolvedValueOnce({});
    await mod.delete_auth_token.execute!({ token_id: "t_1" }, toolOpts);
  });
});
