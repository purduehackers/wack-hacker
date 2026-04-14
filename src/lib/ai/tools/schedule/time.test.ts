import { describe, it, expect } from "vitest";

import { toolOpts } from "@/lib/test/fixtures";

import { currentTime } from "./time.ts";

describe("currentTime tool", () => {
  it("returns current time in UTC by default", async () => {
    const result = await currentTime.execute!({ timezone: undefined }, toolOpts);
    expect(result).toContain("UTC");
  });

  it("returns time in a specified timezone", async () => {
    const result = await currentTime.execute!({ timezone: "America/New_York" }, toolOpts);
    expect(result).toMatch(/E[SD]T/);
  });

  it("returns error message for invalid timezone", async () => {
    const result = await currentTime.execute!({ timezone: "Not/Real" }, toolOpts);
    expect(result).toContain("Invalid timezone");
  });
});
