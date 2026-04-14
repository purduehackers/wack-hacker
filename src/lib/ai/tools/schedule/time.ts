import { tool } from "ai";
import { z } from "zod";

export const currentTime = tool({
  description: "Get the current date and time, optionally in a specific timezone.",
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe("IANA timezone (e.g. 'America/New_York'). Defaults to UTC."),
  }),
  execute: async ({ timezone }) => {
    const tz = timezone ?? "UTC";
    try {
      return new Date().toLocaleString("en-US", {
        timeZone: tz,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });
    } catch {
      return `Invalid timezone "${tz}". Use IANA format like "America/New_York".`;
    }
  },
});
