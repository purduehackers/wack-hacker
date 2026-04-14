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
  options?: SendOptions & { oidcToken?: string },
): Promise<SendResult> {
  if (options?.oidcToken) {
    const { oidcToken, ...rest } = options;
    const client = new QueueClient({ region: "iad1", token: oidcToken });
    return client.send(topicName, payload, rest);
  }
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
