import { createCollaborationNoteArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const create_collaboration_note = defineBufferOperation(
  "createCollaborationNote",
  createCollaborationNoteArguments,
);
