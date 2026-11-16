import { removePostFromContentItemArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const remove_post_from_content_item = defineBufferOperation(
  "removePostFromContentItem",
  removePostFromContentItemArguments,
);
