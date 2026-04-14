import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  bunVersion: "1.x",
  crons: [
    {
      path: "/api/discord/gateway",
      schedule: "*/9 * * * *",
    },
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
    "src/app/api/[[...route]]/route.ts": {
      maxDuration: "max",
    },
  },
};
