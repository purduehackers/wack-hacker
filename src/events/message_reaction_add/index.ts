import { Events } from "discord.js";

import commitOverflow from "./commit-overflow";

export const eventType = Events.MessageReactionAdd;
export { commitOverflow };
