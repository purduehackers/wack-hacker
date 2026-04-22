import { beforeEach, describe, expect, it, vi } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

const getAuthUser = vi.fn();
const getTeams = vi.fn();
const listUserEvents = vi.fn();
const listEventTypes = vi.fn();

vi.mock("./client.ts", () => ({
  vercel: () => ({
    user: { getAuthUser, listUserEvents, listEventTypes },
    teams: { getTeams },
  }),
}));

vi.mock("./constants.ts", () => ({
  VERCEL_TEAM_ID: "team_test",
  VERCEL_TEAM_SLUG: "purduehackers",
  VERCEL_DASHBOARD_BASE: "https://vercel.com/purduehackers",
}));

const { whoami, list_teams, list_user_events, list_event_types } = await import("./account.ts");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("whoami", () => {
  it("returns the auth user plus team context", async () => {
    getAuthUser.mockResolvedValueOnce({ user: { id: "u_1", username: "ray" } });
    const raw = await whoami.execute!({}, toolOpts);
    const out = JSON.parse(raw as string);
    expect(out.user.user.username).toBe("ray");
    expect(out.team).toEqual({ id: "team_test", slug: "purduehackers" });
  });
});

describe("list_teams", () => {
  it("forwards pagination params", async () => {
    getTeams.mockResolvedValueOnce({ teams: [], pagination: {} });
    await list_teams.execute!({ limit: 50, since: 1, until: 2 }, toolOpts);
    expect(getTeams).toHaveBeenCalledWith({ limit: 50, since: 1, until: 2 });
  });
});

describe("list_user_events", () => {
  it("injects team scoping", async () => {
    listUserEvents.mockResolvedValueOnce({ events: [] });
    await list_user_events.execute!({ limit: 10, types: "deployment-ready" }, toolOpts);
    expect(listUserEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team_test",
        slug: "purduehackers",
        types: "deployment-ready",
        limit: 10,
      }),
    );
  });
});

describe("list_event_types", () => {
  it("scopes to the active team", async () => {
    listEventTypes.mockResolvedValueOnce({ types: [] });
    await list_event_types.execute!({}, toolOpts);
    expect(listEventTypes).toHaveBeenCalledWith({ teamId: "team_test", slug: "purduehackers" });
  });
});
