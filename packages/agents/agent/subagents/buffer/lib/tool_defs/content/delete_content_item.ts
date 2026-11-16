import { deleteContentItemArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const delete_content_item = defineBufferOperation(
  "deleteContentItem",
  deleteContentItemArguments,
);
