import { describe, it, expect } from "vitest";

import { TEST_PUBLIC_KEY, signedRequest } from "../test/fixtures";
import { verifyInteraction } from "./verify";

describe("verifyInteraction", () => {
  it("returns invalid when signature header is missing", async () => {
    const req = new Request("https://test", { method: "POST", body: "{}" });
    expect((await verifyInteraction(req, TEST_PUBLIC_KEY)).valid).toBe(false);
  });

  it("returns invalid when timestamp header is missing", async () => {
    const req = new Request("https://test", {
      method: "POST",
      body: "{}",
      headers: { "X-Signature-Ed25519": "bad" },
    });
    expect((await verifyInteraction(req, TEST_PUBLIC_KEY)).valid).toBe(false);
  });

  it("returns invalid for tampered body", async () => {
    const req = signedRequest('{"type":1}');
    // Replace the body with different content (signature no longer matches)
    const tampered = new Request(req.url, {
      method: "POST",
      body: '{"type":2}',
      headers: req.headers,
    });
    expect((await verifyInteraction(tampered, TEST_PUBLIC_KEY)).valid).toBe(false);
  });

  it("returns valid with parsed body for correct signature", async () => {
    const body = JSON.stringify({ type: 1, id: "test" });
    const result = await verifyInteraction(signedRequest(body), TEST_PUBLIC_KEY);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.body).toEqual({ type: 1, id: "test" });
    }
  });
});
