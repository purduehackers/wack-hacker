import { describe, expect, it } from "vitest";

import { buildGitHubCredentialBrokeringPolicy } from "./credential-brokering.ts";

describe("buildGitHubCredentialBrokeringPolicy", () => {
  it("returns the permissive default when no token is supplied", () => {
    const policy = buildGitHubCredentialBrokeringPolicy();
    expect(Object.keys(policy.allow)).toEqual(["*"]);
    expect(policy.allow["*"]).toEqual([]);
  });

  it("injects Bearer auth for API/upload hosts when a token is supplied", () => {
    const policy = buildGitHubCredentialBrokeringPolicy("ghs_token");
    for (const host of ["api.github.com", "uploads.github.com", "codeload.github.com"]) {
      const rules = policy.allow[host];
      expect(rules, host).toBeDefined();
      expect(rules?.[0]?.transform?.[0]?.headers?.Authorization).toBe("Bearer ghs_token");
    }
  });

  it("uses Basic auth for github.com (git HTTPS) so git push works", () => {
    const policy = buildGitHubCredentialBrokeringPolicy("ghs_token");
    const expected = Buffer.from("x-access-token:ghs_token", "utf-8").toString("base64");
    const rules = policy.allow["github.com"];
    expect(rules?.[0]?.transform?.[0]?.headers?.Authorization).toBe(`Basic ${expected}`);
  });

  it("preserves the permissive wildcard alongside the authenticated hosts", () => {
    const policy = buildGitHubCredentialBrokeringPolicy("ghs_token");
    expect(policy.allow["*"]).toEqual([]);
  });
});
