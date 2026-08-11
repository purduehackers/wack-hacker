import { defineTool } from "eve/tools";
import { z } from "zod";

import { approveScheduleMutation, requireScheduleMutationOwner } from "../lib/schedule/owner.ts";
import { getScheduleStore } from "../lib/schedule/store.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineTool({
  description: "Cancel one active scheduled task owned by the current Discord user.",
  inputSchema: z.strictObject({ id: z.uuid() }),
  approval: (ctx) => approveScheduleMutation("cancel_task", ctx),
  async execute({ id }, ctx) {
    return guardToolExecution(async () => {
      const scheduleStore = await getScheduleStore();
      const cancelled = await scheduleStore.cancel(
        requireScheduleMutationOwner(ctx, "cancel_task"),
        id,
      );
      return { cancelled: cancelled.unwrap("cancel scheduled task") };
    });
  },
});
