import { describe, expect, it } from "vitest";

import { access, getAccessSpec, resolveAccessSpec } from "./access.ts";

describe("getAccessSpec", () => {
  it("returns null for non-objects and unmarked objects", () => {
    expect(getAccessSpec(null)).toBeNull();
    expect(getAccessSpec(undefined)).toBeNull();
    expect(getAccessSpec("tool")).toBeNull();
    expect(getAccessSpec({})).toBeNull();
  });

  it("returns the attached spec", () => {
    const t = access({ risk: "read" }, { description: "x" });
    expect(getAccessSpec(t)).toEqual({ risk: "read" });
  });
});

describe("resolveAccessSpec", () => {
  it("falls back to behavior-preserving legacy semantics for unmarked tools", () => {
    expect(resolveAccessSpec({ description: "x" })).toEqual({
      risk: "write",
      minRole: "public",
      confirm: "none",
    });
  });
});
