import { log } from "evlog";

import { defineCron } from "@/lib/bot/crons/define";

export const heartbeat = defineCron({
  name: "heartbeat",
  schedule: "0 * * * *",
  async handle() {
    log.info("cron", "Heartbeat");
  },
});
