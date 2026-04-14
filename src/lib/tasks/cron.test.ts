import { describe, it, expect } from "vitest";

import { nextOccurrence } from "./cron";

describe("nextOccurrence", () => {
  it("finds the next daily occurrence", () => {
    // 9:00 AM every day, after 10 AM on April 8 → April 9 at 9:00 AM
    const after = new Date("2026-04-08T14:00:00Z"); // 10 AM EDT
    const next = nextOccurrence("0 9 * * *", after, "America/New_York");
    expect(next.toISOString()).toBe("2026-04-09T13:00:00.000Z"); // 9 AM EDT = 1 PM UTC
  });

  it("finds the next occurrence today if time hasn't passed", () => {
    // 9:00 AM every day, after 8 AM → today at 9:00 AM
    const after = new Date("2026-04-08T12:00:00Z"); // 8 AM EDT
    const next = nextOccurrence("0 9 * * *", after, "America/New_York");
    expect(next.toISOString()).toBe("2026-04-08T13:00:00.000Z");
  });

  it("handles weekday-only cron (Mon-Fri)", () => {
    // 9 AM Mon-Fri, after Friday 10 AM → Monday 9 AM
    const friday = new Date("2026-04-10T14:00:00Z"); // Friday 10 AM EDT
    const next = nextOccurrence("0 9 * * 1-5", friday, "America/New_York");
    // Next Monday is April 13
    expect(next.toISOString()).toBe("2026-04-13T13:00:00.000Z");
  });

  it("handles step expressions (*/15)", () => {
    const after = new Date("2026-04-08T14:07:00Z"); // 10:07 AM EDT
    const next = nextOccurrence("*/15 * * * *", after, "America/New_York");
    // Next 15-min boundary: 10:15 AM EDT
    expect(next.toISOString()).toBe("2026-04-08T14:15:00.000Z");
  });

  it("handles list expressions (1,15,30)", () => {
    const after = new Date("2026-04-08T14:16:00Z"); // 10:16 AM EDT
    const next = nextOccurrence("1,15,30 * * * *", after, "America/New_York");
    // Next matching minute: :30
    expect(next.toISOString()).toBe("2026-04-08T14:30:00.000Z");
  });

  it("handles specific day of month", () => {
    // 1st of every month at noon
    const after = new Date("2026-04-08T16:00:00Z"); // April 8
    const next = nextOccurrence("0 12 1 * *", after, "America/New_York");
    // May 1 at noon EDT
    expect(next.toISOString()).toBe("2026-05-01T16:00:00.000Z");
  });

  it("crosses year boundary", () => {
    // Jan 1 at midnight
    const after = new Date("2026-12-31T05:00:00Z"); // Dec 31
    const next = nextOccurrence("0 0 1 1 *", after, "America/New_York");
    // Jan 1, 2027 at midnight EST (UTC-5)
    expect(next.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("uses default timezone (Indianapolis) when none specified", () => {
    const after = new Date("2026-04-08T14:00:00Z"); // 10 AM EDT
    const next = nextOccurrence("0 9 * * *", after);
    // Indianapolis is also EDT (UTC-4) in April
    expect(next.toISOString()).toBe("2026-04-09T13:00:00.000Z");
  });

  it("throws for invalid cron expression", () => {
    expect(() => nextOccurrence("invalid", new Date())).toThrow("expected 5 fields");
    expect(() => nextOccurrence("* * *", new Date())).toThrow("expected 5 fields");
  });
});
