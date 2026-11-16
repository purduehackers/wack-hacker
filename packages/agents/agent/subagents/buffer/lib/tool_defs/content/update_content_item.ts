import { updateContentItemArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const update_content_item = defineBufferOperation(
  "updateContentItem",
  updateContentItemArguments,
);
