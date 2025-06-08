import { Events } from "discord.js";

import autoThreadChannels from "./auto-thread-channels";
import dashboard from "./dashboard";
import evergreenIt from "./evergreen-it";
import voiceMessageTranscription from "./voice-transcription";
import welcomer from "./welcomer";

export const eventType = Events.MessageCreate;
export {
  autoThreadChannels,
  dashboard,
  evergreenIt,
  voiceMessageTranscription,
  welcomer,
};
