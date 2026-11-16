import { defineSchedule } from "eve/schedules";

import { env } from "../env.ts";
import { collectBufferSnapshots } from "../subagents/buffer/lib/snapshots.ts";

export default defineSchedule({
  cron: "0 9 * * *",
  run({ waitUntil }) {
    if (env.BUFFER_SNAPSHOTS_ENABLED)
      waitUntil(collectBufferSnapshots(AbortSignal.timeout(240_000)));
  },
});
