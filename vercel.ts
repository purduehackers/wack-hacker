import { type VercelConfig } from "@vercel/config/v1";

import { buildCronRoutes } from "@/bot/crons/config";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/discord/gateway",
      // Literal (not the GATEWAY_KEEPALIVE_CRON constant): Vercel evaluates this
      // file with a TS loader that resolves the value of aliased const imports
      // to `undefined`, which drops `schedule` and fails config validation. Keep
      // this in sync with GATEWAY_KEEPALIVE_CRON in server/routes/gateway/constants.ts.
      schedule: "*/9 * * * *",
    },
    ...buildCronRoutes(),
  ],
  functions: {
    "src/app/api/tasks/route.ts": {
      maxDuration: 600,
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: "tasks",
        },
      ],
    },
    "src/app/api/discord/events/route.ts": {
      maxDuration: 600,
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: "discord-events",
        },
      ],
    },
    "src/app/api/[[...route]]/route.ts": {
      maxDuration: "max",
    },
    // Workflow DevKit handler routes, generated into src/app at build time
    // (gitignored). The step handler executes entire chat turns — long Opus
    // code-domain turns get killed mid-stream and replayed under the default
    // duration.
    "src/app/.well-known/workflow/v1/step/route.js": {
      maxDuration: "max",
    },
    "src/app/.well-known/workflow/v1/flow/route.js": {
      maxDuration: "max",
    },
  },
};
