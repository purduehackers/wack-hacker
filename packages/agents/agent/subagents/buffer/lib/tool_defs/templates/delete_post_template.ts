import { deletePostTemplateArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const delete_post_template = defineBufferOperation(
  "deletePostTemplate",
  deletePostTemplateArguments,
);
