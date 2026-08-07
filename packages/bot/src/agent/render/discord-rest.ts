/** Discord REST port backed by the gateway client's single rate-limit manager. */

import { RateLimited, Transient, UpstreamError, httpStatusOf } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type {
  APIMessage,
  Client,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageJSONBody,
} from "discord.js";

export type DiscordError = RateLimited | Transient | UpstreamError;
type RestClient = Pick<Client["rest"], "delete" | "patch" | "post">;

function toDiscordError(operation: string) {
  return (cause: unknown): DiscordError => {
    const status = httpStatusOf(cause);
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (status === 429) return new RateLimited({ service: "discord", retryAfterMs: 1_000 });
    if (status !== undefined && status < 500) {
      return new UpstreamError({ service: "discord", status, detail });
    }
    return new Transient({ operation, detail });
  };
}

export type PostedMessage = Pick<APIMessage, "content" | "id">;

function readPostedMessage(created: unknown): Result<PostedMessage, DiscordError> {
  const id =
    typeof created === "object" && created !== undefined
      ? Reflect.get(Object(created), "id")
      : undefined;
  if (typeof id === "string" && id !== "") {
    const content = Reflect.get(Object(created), "content");
    if (typeof content === "string") return Result.ok({ id, content });
  }
  return Result.err(
    new UpstreamError({
      service: "discord",
      status: 200,
      detail: "message response carried no id",
    }),
  );
}

export function createDiscordRest(rest: RestClient) {
  return {
    postMessage: async (
      channelId: string,
      body: RESTPostAPIChannelMessageJSONBody,
    ): Promise<Result<PostedMessage, DiscordError>> => {
      const created = await Result.tryPromise({
        try: () =>
          rest.post(`/channels/${channelId}/messages`, {
            body,
            signal: AbortSignal.timeout(30_000),
          }),
        catch: toDiscordError("post discord message"),
      });
      return created.andThen((raw) => readPostedMessage(raw));
    },

    editMessage: async (
      channelId: string,
      messageId: string,
      content: string,
      components: NonNullable<RESTPatchAPIChannelMessageJSONBody["components"]> = [],
    ): Promise<Result<undefined, DiscordError>> =>
      Result.tryPromise({
        try: async () => {
          await rest.patch(`/channels/${channelId}/messages/${messageId}`, {
            body: { content, components, allowed_mentions: { parse: [] } },
            signal: AbortSignal.timeout(30_000),
          });
          return undefined;
        },
        catch: toDiscordError("edit discord message"),
      }),

    deleteMessage: async (
      channelId: string,
      messageId: string,
    ): Promise<Result<undefined, DiscordError>> =>
      Result.tryPromise({
        try: async () => {
          try {
            await rest.delete(`/channels/${channelId}/messages/${messageId}`, {
              signal: AbortSignal.timeout(30_000),
            });
          } catch (cause) {
            if (httpStatusOf(cause) !== 404) throw cause;
          }
          return undefined;
        },
        catch: toDiscordError("delete discord message"),
      }),

    reply: async (
      channelId: string,
      messageId: string,
      content: string,
      nonce?: string,
      components: NonNullable<RESTPostAPIChannelMessageJSONBody["components"]> = [],
    ): Promise<Result<PostedMessage, DiscordError>> => {
      const created = await Result.tryPromise({
        try: () =>
          rest.post(`/channels/${channelId}/messages`, {
            body: {
              content,
              components,
              message_reference: { message_id: messageId, fail_if_not_exists: false },
              allowed_mentions: { parse: [] },
              ...(nonce === undefined ? {} : { nonce, enforce_nonce: true as const }),
            },
            signal: AbortSignal.timeout(30_000),
          }),
        catch: toDiscordError("reply to discord message"),
      });
      return created.andThen((raw) => readPostedMessage(raw));
    },
  };
}

export type DiscordRest = ReturnType<typeof createDiscordRest>;
