import { defineTool } from "eve/tools";
import { z } from "zod";

import { approveScheduleMutation, requireScheduleMutationOwner } from "../lib/schedule/owner.ts";
import { getScheduleStore } from "../lib/schedule/store.ts";
import { storedJson } from "../lib/schema.ts";
import { guardToolExecution } from "../lib/serialization.ts";

const scheduleShape = z.discriminatedUnion("type", [
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

/**
 * The nested schedule, as an object or as JSON text of one.
 *
 * Models routinely serialize a nested tool argument as a string rather than an
 * object, and reliably so for a discriminated union. Eve validates
 * `inputSchema` before the executor runs, so such a call never reaches this
 * file: the model just sees a type error about a shape it has already decided
 * how to emit, and retries it unchanged. Accepting both is the same boundary
 * parse this package already does for values Redis hands back either way.
 */
const schedule = storedJson(scheduleShape);

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
