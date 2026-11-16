import { promoteContentItemDraftToPostsArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const promote_content_item_draft_to_posts = defineBufferOperation(
  "promoteContentItemDraftToPosts",
  promoteContentItemDraftToPostsArguments,
);
