import { deleteCollaborationNoteArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const delete_collaboration_note = defineBufferOperation(
  "deleteCollaborationNote",
  deleteCollaborationNoteArguments,
);
