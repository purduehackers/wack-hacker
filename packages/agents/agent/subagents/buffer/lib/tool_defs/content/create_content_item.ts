import { createContentItemArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const create_content_item = defineBufferOperation(
  "createContentItem",
  createContentItemArguments,
);
