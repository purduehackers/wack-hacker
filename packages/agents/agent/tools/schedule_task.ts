import { defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../lib/core/serialization.ts";
import { approveScheduleMutation, requireScheduleMutationOwner } from "../lib/schedule-owner.ts";
import { getScheduleStore } from "../lib/schedule-store.ts";

const schedule = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("once"),
    runAt: z.iso.datetime({ offset: true }),
  }),
  z.strictObject({
    type: z.literal("recurring"),
    cron: z.string().trim().min(9).max(128),
    timezone: z.string().trim().min(1).max(128),
  }),
]);

export default defineTool({
  description:
    "Schedule a prompt for this Discord destination, either once at an explicit ISO time or on a five-field cron in an IANA timezone.",
  inputSchema: z.strictObject({
    description: z.string().trim().min(1).max(256),
    prompt: z.string().trim().min(1).max(8_000),
    schedule,
  }),
  approval: (ctx) => approveScheduleMutation("schedule_task", ctx),
  async execute({ description, prompt, schedule }, ctx) {
    return guardToolExecution(async () => {
      const owner = requireScheduleMutationOwner(ctx, "schedule_task");
      const scheduleStore = await getScheduleStore();
      const created = await (schedule.type === "once"
        ? scheduleStore.create(owner, {
            type: schedule.type,
            description,
            prompt,
            runAt: new Date(schedule.runAt),
          })
        : scheduleStore.create(owner, {
            type: schedule.type,
            description,
            prompt,
            cron: schedule.cron,
            timezone: schedule.timezone,
          }));
      return created.unwrap("create scheduled task");
    });
  },
});
