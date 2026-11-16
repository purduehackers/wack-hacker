import { updateContentItemDraftArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const update_content_item_draft = defineBufferOperation(
  "updateContentItemDraft",
  updateContentItemDraftArguments,
);
