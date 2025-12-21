import { Events } from "discord.js";

import autoThreadChannels from "./auto-thread-channels";
import commitOverflow from "./commit-overflow";
// import dashboard from "./dashboard";
import evergreenIt from "./evergreen-it";
import grok from "./grok";
import hackNightImages from "./hack-night-images";
import voiceMessageTranscription from "./voice-transcription";
import welcomer from "./welcomer";
import praise from "./praise";

export const eventType = Events.MessageCreate;
export {
	autoThreadChannels,
	commitOverflow,
	// dashboard,
	evergreenIt,
	voiceMessageTranscription,
	welcomer,
	grok,
	hackNightImages,
	praise,
};
