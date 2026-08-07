import { defineTool } from "eve/tools";
import { z } from "zod";

import { guardToolExecution } from "../lib/core/serialization.ts";
import { approveScheduleMutation, requireScheduleOwner } from "../lib/schedule-owner.ts";
import { getScheduleStore } from "../lib/schedule-store.ts";

export default defineTool({
  description: "Cancel one active scheduled task owned by the current Discord user.",
  inputSchema: z.strictObject({ id: z.uuid() }),
  approval: (ctx) => approveScheduleMutation("cancel_task", ctx),
  async execute({ id }, ctx) {
    return guardToolExecution(async () => {
      const scheduleStore = await getScheduleStore();
      const cancelled = await scheduleStore.cancel(requireScheduleOwner(ctx), id);
      return { cancelled: cancelled.unwrap("cancel scheduled task") };
    });
  },
});
