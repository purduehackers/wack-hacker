import type { SerializedMessage } from "chat";

export type ChatTurnPayload = {
  message: SerializedMessage;
};
