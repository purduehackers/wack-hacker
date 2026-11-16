import { updatePostTemplateArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const update_post_template = defineBufferOperation(
  "updatePostTemplate",
  updatePostTemplateArguments,
);
