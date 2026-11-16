import { dailyPostingLimitsArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const daily_posting_limits = defineBufferOperation(
  "dailyPostingLimits",
  dailyPostingLimitsArguments,
);
