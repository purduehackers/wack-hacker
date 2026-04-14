import { tool } from "ai";
import { z } from "zod";

import { linear } from "./client.ts";

export const set_reminder = tool({
  description:
    "Set a reminder on an issue. Triggers a Linear notification at the specified time. One reminder per issue (replaces any existing). Resolve the issue ID via search_entities first.",
  inputSchema: z.object({
    issueId: z.string(),
    reminderAt: z.string().describe("ISO 8601 datetime"),
  }),
  execute: async ({ issueId, reminderAt }) => {
    const payload = await linear.issueReminder(issueId, new Date(reminderAt));
    const issue = await payload.issue;
    if (!issue) return "Failed to set reminder";
    return JSON.stringify({ id: issue.id, identifier: issue.identifier, url: issue.url });
  },
});
