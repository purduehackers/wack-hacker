import { defineSchedule } from "eve/schedules";

import { cleanupArtifacts } from "../lib/artifacts/cleanup.ts";

export default defineSchedule({
  cron: "30 8 * * *",
  run({ waitUntil }) {
    waitUntil(cleanupArtifacts());
  },
});
