import { describe, expect, it, vi } from "vitest";

import { payloadSDKClass } from "@/lib/test/fixtures";

class MockPayloadSDKError extends Error {
  status: number;
  errors?: Array<{ message: string }>;
  response?: Response;
  constructor(opts: {
    status: number;
    message: string;
    errors?: Array<{ message: string }>;
    response?: Response;
  }) {
    super(opts.message);
    this.name = "PayloadSDKError";
    this.status = opts.status;
    this.errors = opts.errors;
    this.response = opts.response;
  }
}

vi.mock("@payloadcms/sdk", () => ({
  PayloadSDK: payloadSDKClass(),
  PayloadSDKError: MockPayloadSDKError,
}));

process.env.PAYLOAD_CMS_API_KEY = "test-key-xyz";

const { payload, cmsAdminUrl, wrapPayloadError } = await import("./client.ts");

describe("payload client", () => {
  it("points at the cms.purduehackers.com API", () => {
    expect(payload.baseURL).toBe("https://cms.purduehackers.com/api");
  });

  it("sets the service-accounts API-Key Authorization header", () => {
    const headers = payload.baseInit.headers as Record<string, string>;
    expect(headers.Authorization).toBe("service-accounts API-Key test-key-xyz");
  });
});

describe("cmsAdminUrl", () => {
  it("builds the admin UI link for a numeric id", () => {
    expect(cmsAdminUrl("ugrants", 42)).toBe(
      "https://cms.purduehackers.com/admin/collections/ugrants/42",
    );
  });

  it("builds the admin UI link for a string id", () => {
    expect(cmsAdminUrl("events", "abc-123")).toBe(
      "https://cms.purduehackers.com/admin/collections/events/abc-123",
    );
  });
});

describe("wrapPayloadError", () => {
  it("maps 401 to an API-key hint", () => {
    const out = wrapPayloadError(new MockPayloadSDKError({ status: 401, message: "Unauthorized" }));
    expect(out.message).toMatch(/401.*PAYLOAD_CMS_API_KEY/);
  });

  it("maps 404 to an id/slug hint", () => {
    const out = wrapPayloadError(new MockPayloadSDKError({ status: 404, message: "Not Found" }));
    expect(out.message).toMatch(/404.*id\/slug/);
  });

  it("includes the first error detail when present", () => {
    const out = wrapPayloadError(
      new MockPayloadSDKError({
        status: 400,
        message: "ValidationError",
        errors: [{ message: "name is required" }],
      }),
    );
    expect(out.message).toContain("400");
    expect(out.message).toContain("name is required");
  });

  it("passes non-SDK errors through unchanged", () => {
    const raw = new Error("boom");
    expect(wrapPayloadError(raw)).toBe(raw);
  });

  it("wraps non-Error values as Error", () => {
    const out = wrapPayloadError("plain string");
    expect(out).toBeInstanceOf(Error);
    expect(out.message).toBe("plain string");
  });
});
