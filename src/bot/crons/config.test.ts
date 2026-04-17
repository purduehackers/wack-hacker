import { describe, it, expect } from "vitest";

import * as crons from "@/bot/handlers/crons";

import type { CronHandler } from "./types";

import { buildCronRoutes } from "./config";

describe("buildCronRoutes", () => {
  it("maps every registered cron handler to a Vercel cron route", () => {
    const registered = Object.values(crons) as CronHandler[];
    const routes = buildCronRoutes();

    expect(routes).toHaveLength(registered.length);
    for (const cron of registered) {
      expect(routes).toContainEqual({
        path: `/api/crons/${cron.name}`,
        schedule: cron.schedule,
      });
    }
  });
});
