import { collaborationNotesArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const collaboration_notes = defineBufferOperation(
  "collaborationNotes",
  collaborationNotesArguments,
);
