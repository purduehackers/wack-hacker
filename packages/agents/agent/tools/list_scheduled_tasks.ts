import { defineTool } from "eve/tools";
import { z } from "zod";

import { requireScheduleOwner } from "../lib/schedule/owner.ts";
import { getScheduleStore } from "../lib/schedule/store.ts";
import { guardToolExecution } from "../lib/serialization.ts";

export default defineTool({
  description: "List scheduled tasks owned by the current Discord user and their latest status.",
  inputSchema: z.strictObject({}),
  async execute(_input, ctx) {
    return guardToolExecution(async () => {
      const scheduleStore = await getScheduleStore();
      const tasks = await scheduleStore.list(requireScheduleOwner(ctx));
      return tasks.unwrap("list scheduled tasks");
    });
  },
});
