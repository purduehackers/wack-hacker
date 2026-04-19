import type { InteractionResponsePayload } from "@/bot/commands/types";

/** Either an InteractionResponse to JSON-serialize, or an error envelope the route should surface. */
export type DispatcherResult = InteractionResponsePayload | { error: string; status: 400 };
