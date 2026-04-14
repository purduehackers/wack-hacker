import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  bunVersion: "1.x",
  crons: [
    {
      path: "/api/discord/gateway",
      schedule: "*/9 * * * *",
    },
  ],
  functions: {
    "api/tasks": {
      experimentalTriggers: [
        {
          type: "queue/v2beta",
          topic: "tasks",
        },
      ],
    },
  },
};
