import type { API } from "@discordjs/core/http-only";

export interface CronHandler {
  name: string;
  schedule: string;
  handle(discord: API): Promise<void>;
}
