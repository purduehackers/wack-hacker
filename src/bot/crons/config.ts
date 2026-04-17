import type { CronJob } from "@vercel/config/v1/types";

import * as crons from "@/bot/handlers/crons";

import type { CronHandler } from "./types";

const CRON_ROUTE_PREFIX = "/api/crons";

export function buildCronRoutes(): CronJob[] {
  return (Object.values(crons) as CronHandler[]).map((cron) => ({
    path: `${CRON_ROUTE_PREFIX}/${cron.name}`,
    schedule: cron.schedule,
  }));
}
