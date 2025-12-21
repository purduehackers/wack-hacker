import { Events } from "discord.js";

import autoThreadChannels from "./auto-thread-channels";
import evergreenIt from "./evergreen-it";
import grok from "./grok";
import hackNightImages from "./hack-night-images";
import voiceMessageTranscription from "./voice-transcription";
import welcomer from "./welcomer";
import praise from "./praise";

export const eventType = Events.MessageCreate;
export {
	autoThreadChannels,
	evergreenIt,
	voiceMessageTranscription,
	welcomer,
	grok,
	hackNightImages,
	praise,
};
