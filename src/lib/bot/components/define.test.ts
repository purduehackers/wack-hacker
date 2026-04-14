import { describe, it, expect } from "vitest";

import { defineComponent } from "./define";

describe("defineComponent", () => {
  it("returns the same object", () => {
    const handler = {
      prefix: "approval",
      async handle() {},
    };
    expect(defineComponent(handler)).toBe(handler);
  });
});
