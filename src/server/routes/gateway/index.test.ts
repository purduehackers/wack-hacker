import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // `env` is read at module load; inject the secret before the route module
  // (and everything it imports) evaluates. Drop any ambient OIDC token so the
  // authorized request deterministically stops at the OIDC-availability gate
  // instead of trying to log into Discord.
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.VERCEL_OIDC_TOKEN;
});

const { default: route } = await import("./index");

// The per-event bind/publish behavior (including the reaction read-off-the-
// partial contract) is covered by src/lib/protocol/events/binds.test.ts now
// that the gateway delegates to bindGatewayEvents.
describe("GET /gateway auth", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await route.request("/gateway");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await route.request("/gateway", {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("proceeds past auth with the cron secret", async () => {
    const res = await route.request("/gateway", {
      headers: { authorization: "Bearer test-cron-secret" },
    });
    // Auth passed; the next gate (OIDC availability) fails in the test env.
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "oidc unavailable" });
  });
});
