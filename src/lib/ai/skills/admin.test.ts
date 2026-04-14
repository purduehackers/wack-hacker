import type { ToolSet } from "ai";

import { describe, expect, it } from "vitest";

import { noopTool } from "@/lib/test/fixtures";

import { admin, filterAdmin } from "./admin.ts";

describe("admin", () => {
  describe("admin()", () => {
    it("returns the same reference it was given", () => {
      const t = noopTool("a");
      expect(admin(t)).toBe(t);
    });

    it("marks the tool so filterAdmin strips it", () => {
      const toolSet: ToolSet = {
        dangerous: admin(noopTool("dangerous")),
      };
      expect(filterAdmin(toolSet)).toEqual({});
    });
  });

  describe("filterAdmin()", () => {
    it("keeps unmarked tools and drops marked ones", () => {
      const search = noopTool("search");
      const read = noopTool("read");
      const banUser = admin(noopTool("banUser"));

      const filtered = filterAdmin({ search, read, banUser });

      expect(Object.keys(filtered).sort()).toEqual(["read", "search"]);
      expect(filtered.search).toBe(search);
      expect(filtered.read).toBe(read);
    });

    it("returns a new object without mutating the input", () => {
      const banUser = admin(noopTool("banUser"));
      const input: ToolSet = { banUser };
      const filtered = filterAdmin(input);
      expect(filtered).not.toBe(input);
      expect(Object.keys(input)).toEqual(["banUser"]);
    });

    it("returns an empty set when every tool is admin", () => {
      const input: ToolSet = {
        a: admin(noopTool("a")),
        b: admin(noopTool("b")),
      };
      expect(filterAdmin(input)).toEqual({});
    });

    it("returns the full set when nothing is marked", () => {
      const a = noopTool("a");
      const b = noopTool("b");
      const filtered = filterAdmin({ a, b });
      expect(filtered).toEqual({ a, b });
    });
  });
});
