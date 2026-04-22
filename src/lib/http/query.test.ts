import { describe, expect, it } from "vitest";

import { stringifyQueryValue } from "./query";

describe("stringifyQueryValue", () => {
  it("stringifies primitives via String()", () => {
    expect(stringifyQueryValue(42)).toBe("42");
    expect(stringifyQueryValue("hi")).toBe("hi");
    expect(stringifyQueryValue(true)).toBe("true");
    expect(stringifyQueryValue(false)).toBe("false");
  });

  it("JSON-encodes objects and arrays so they don't render as [object Object]", () => {
    expect(stringifyQueryValue({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
    expect(stringifyQueryValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("collapses null and undefined to an empty string", () => {
    expect(stringifyQueryValue(null)).toBe("");
    expect(stringifyQueryValue(undefined)).toBe("");
  });
});
