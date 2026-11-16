import { updateCollaborationNoteArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const update_collaboration_note = defineBufferOperation(
  "updateCollaborationNote",
  updateCollaborationNoteArguments,
);
