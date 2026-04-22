import { describe, expect, it } from "vitest";

import { noopTool } from "@/lib/test/fixtures";

import { approval, getApprovalOptions, hasApprovalMarker } from "./index.ts";

describe("approval", () => {
  describe("approval()", () => {
    it("returns the same reference it was given", () => {
      const t = noopTool("a");
      expect(approval(t)).toBe(t);
    });

    it("marks the tool so hasApprovalMarker returns true", () => {
      const t = approval(noopTool("gated"));
      expect(hasApprovalMarker(t)).toBe(true);
    });

    it("stores the options so getApprovalOptions returns them", () => {
      const t = approval(noopTool("gated"), { reason: "destructive" });
      expect(getApprovalOptions(t)).toEqual({ reason: "destructive" });
    });

    it("defaults to an empty options object when none is given", () => {
      const t = approval(noopTool("gated"));
      expect(getApprovalOptions(t)).toEqual({});
    });
  });

  describe("hasApprovalMarker() / getApprovalOptions()", () => {
    it("returns false/null for unmarked tools", () => {
      const t = noopTool("plain");
      expect(hasApprovalMarker(t)).toBe(false);
      expect(getApprovalOptions(t)).toBeNull();
    });

    it("returns null for non-object values", () => {
      expect(getApprovalOptions(null)).toBeNull();
      expect(getApprovalOptions(undefined)).toBeNull();
      expect(getApprovalOptions("string")).toBeNull();
      expect(getApprovalOptions(42)).toBeNull();
    });
  });
});
