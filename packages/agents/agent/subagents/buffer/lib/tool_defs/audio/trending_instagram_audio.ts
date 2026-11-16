import { trendingInstagramAudioArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const trending_instagram_audio = defineBufferOperation(
  "trendingInstagramAudio",
  trendingInstagramAudioArguments,
);
