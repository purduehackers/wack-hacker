import { describe, it, expect } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

import { current_time } from "./time.ts";

describe("current_time tool", () => {
  it("returns current time in UTC by default", async () => {
    const result = await current_time.execute!({ timezone: undefined }, toolOpts);
    expect(result).toContain("UTC");
  });

  it("returns time in a specified timezone", async () => {
    const result = await current_time.execute!({ timezone: "America/New_York" }, toolOpts);
    expect(result).toMatch(/E[SD]T/);
  });

  it("returns error message for invalid timezone", async () => {
    const result = await current_time.execute!({ timezone: "Not/Real" }, toolOpts);
    expect(result).toContain("Invalid timezone");
  });
});
