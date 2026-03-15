import type { SerializedMessage } from "chat";

/** Payload sent when resuming a chat workflow with a follow-up message. */
export type ChatTurnPayload = {
  message: SerializedMessage;
};
