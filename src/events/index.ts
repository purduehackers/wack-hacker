import { env } from "../env";
import * as messageCreate from "./message_create";
import * as messageReactionAdd from "./message_reaction_add";
import commitOverflowMessageCreate from "./message_create/commit-overflow";

type EventModule = Record<string, unknown> & { eventType: string };

const messageCreateWithCommitOverflow: EventModule = env.COMMIT_OVERFLOW_ENABLED === "1"
	? { ...messageCreate, commitOverflow: commitOverflowMessageCreate }
	: { ...messageCreate };

export const events: EventModule[] = env.COMMIT_OVERFLOW_ENABLED === "1"
	? [messageCreateWithCommitOverflow, messageReactionAdd]
	: [messageCreateWithCommitOverflow];
