import { movePostInQueueArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const move_post_in_queue = defineBufferOperation(
  "movePostInQueue",
  movePostInQueueArguments,
);
