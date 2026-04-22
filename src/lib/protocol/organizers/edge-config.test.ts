import { beforeEach, describe, expect, it, vi } from "vitest";

const { parseSpy } = vi.hoisted(() => ({ parseSpy: vi.fn() }));

vi.mock("@vercel/edge-config", () => ({
  parseConnectionString: parseSpy,
}));

import { getDashboardEdgeConfigId } from "./edge-config.ts";

beforeEach(() => {
  parseSpy.mockReset();
});

describe("getDashboardEdgeConfigId", () => {
  it("returns the parsed id when the connection string is valid", () => {
    parseSpy.mockReturnValue({
      baseUrl: "https://edge-config.vercel.com",
      id: "ecfg_abc",
      token: "tkn",
      version: "1",
      type: "vercel",
    });
    expect(getDashboardEdgeConfigId()).toBe("ecfg_abc");
  });

  it("throws when the connection string cannot be parsed", () => {
    parseSpy.mockReturnValue(null);
    expect(() => getDashboardEdgeConfigId()).toThrow(
      /DASHBOARD_EDGE_CONFIG is not a valid Edge Config connection string/,
    );
  });
});
