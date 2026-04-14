import { describe, it, expect } from "vitest";

import { defineCron } from "./define";

describe("defineCron", () => {
  it("returns the same object", () => {
    const cron = { name: "test", schedule: "0 * * * *", handle: async () => {} };
    expect(defineCron(cron)).toBe(cron);
  });
});
