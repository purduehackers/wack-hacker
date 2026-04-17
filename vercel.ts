import { type VercelConfig } from "@vercel/config/v1";

import { buildCronRoutes } from "@/bot/crons/config";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      path: "/api/discord/gateway",
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
  },
};
