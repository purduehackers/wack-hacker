import { addPostToContentItemArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const add_post_to_content_item = defineBufferOperation(
  "addPostToContentItem",
  addPostToContentItemArguments,
);
