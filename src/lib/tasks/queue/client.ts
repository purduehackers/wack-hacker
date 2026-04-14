import {
  QueueClient,
  type MessageHandler,
  type RetryHandler,
  type SendOptions,
  type SendResult,
} from "@vercel/queue";

const queue = new QueueClient({ region: "iad1" });

export function send<T = unknown>(
  topicName: string,
  payload: T,
  options?: SendOptions,
): Promise<SendResult> {
  return queue.send(topicName, payload, options);
}

export function handleCallback<T = unknown>(
  handler: MessageHandler<T>,
  options?: {
    visibilityTimeoutSeconds?: number;
    retry?: RetryHandler;
  },
) {
  return queue.handleCallback<T>(handler, options);
}
