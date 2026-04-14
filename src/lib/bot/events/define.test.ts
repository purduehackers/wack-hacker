import { describe, it, expect } from "vitest";

import { defineEvent } from "./define";

describe("defineEvent", () => {
  it("returns the same object", () => {
    const event = { type: "message" as const, handle: async () => {} };
    expect(defineEvent(event)).toBe(event);
  });
});
