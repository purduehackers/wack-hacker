import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [
    {
      path: "/api/discord/gateway",
      schedule: "*/9 * * * *",
    },
  ],
};
