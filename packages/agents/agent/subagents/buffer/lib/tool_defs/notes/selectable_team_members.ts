import { selectableTeamMembersArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const selectable_team_members = defineBufferOperation(
  "selectableTeamMembers",
  selectableTeamMembersArguments,
);
