import { searchInstagramAudioCatalogArguments } from "../../inputs.ts";
import { defineBufferOperation } from "../../operation.ts";
export const search_instagram_audio_catalog = defineBufferOperation(
  "searchInstagramAudioCatalog",
  searchInstagramAudioCatalogArguments,
);
