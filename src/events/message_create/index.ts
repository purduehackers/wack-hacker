import { Events } from "discord.js";

import dashboard from "./dashboard";
import evergreenIt from "./evergreen-it";
import voiceMessageTranscription from "./voice-transcription";

export const eventType = Events.MessageCreate;
export { dashboard, evergreenIt, voiceMessageTranscription };
