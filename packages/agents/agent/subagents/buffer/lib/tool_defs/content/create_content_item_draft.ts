import { createContentItemDraftArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const create_content_item_draft = defineBufferOperation(
  "createContentItemDraft",
  createContentItemDraftArguments,
);
