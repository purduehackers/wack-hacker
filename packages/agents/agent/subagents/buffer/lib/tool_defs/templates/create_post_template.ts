import { createPostTemplateArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const create_post_template = defineBufferOperation(
  "createPostTemplate",
  createPostTemplateArguments,
);
