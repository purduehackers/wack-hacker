import { searchInstagramAudioArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const search_instagram_audio = defineBufferOperation(
  "searchInstagramAudio",
  searchInstagramAudioArguments,
);
