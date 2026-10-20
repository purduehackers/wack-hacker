/** Discord REST port backed by the gateway client's single rate-limit manager. */

import {
  httpStatusOf,
  messageOf,
  RateLimited,
  Transient,
  UpstreamError,
} from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type {
  APIMessage,
  Client,
  RESTPatchAPIChannelMessageJSONBody,
  RESTPostAPIChannelMessageJSONBody,
} from "discord.js";
import { z } from "zod";

export type DiscordError = RateLimited | Transient | UpstreamError;
type RestClient = Pick<Client["rest"], "delete" | "patch" | "post">;

export interface DiscordTextFile {
  readonly filename: string;
  readonly text: string;
}

function upload(file: DiscordTextFile | undefined) {
  return file === undefined
    ? {}
    : { files: [{ name: file.filename, data: Buffer.from(file.text, "utf8") }] };
}

function toDiscordError(operation: string) {
  return (cause: unknown): DiscordError => {
    const status = httpStatusOf(cause);
    const detail = messageOf(cause);
    if (status === 429) return new RateLimited({ service: "discord", retryAfterMs: 1_000 });
    if (status !== undefined && status < 500) {
      return new UpstreamError({ service: "discord", status, detail });
    }
    return new Transient({ operation, detail });
  };
}

type PostedMessage = Pick<APIMessage, "content" | "id">;

/** The only fields this module reads back from a created message. */
const postedMessageSchema = z.object({ id: z.string().min(1), content: z.string() });

/** `REST#post` is declared as `Promise<unknown>`, so this is the parse boundary. */
function readPostedMessage(created: unknown): Result<PostedMessage, DiscordError> {
  const parsed = postedMessageSchema.safeParse(created);
  if (parsed.success) return Result.ok(parsed.data);
  return Result.err(
    new UpstreamError({
      service: "discord",
      status: 200,
      detail: `invalid message response: ${z.prettifyError(parsed.error)}`,
    }),
  );
}

export function createDiscordRest(rest: RestClient) {
  return {
    postMessage: async (
      channelId: string,
      body: RESTPostAPIChannelMessageJSONBody,
      file?: DiscordTextFile,
    ): Promise<Result<PostedMessage, DiscordError>> => {
      const created = await Result.tryPromise({
        try: () =>
          rest.post(`/channels/${channelId}/messages`, {
            body: {
              ...body,
              ...(file === undefined
                ? {}
                : { attachments: [{ id: "0", filename: file.filename }] }),
            },
            ...upload(file),
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
      file?: DiscordTextFile,
    ): Promise<Result<undefined, DiscordError>> =>
      Result.tryPromise({
        try: async () => {
          await rest.patch(`/channels/${channelId}/messages/${messageId}`, {
            body: {
              content,
              components,
              allowed_mentions: { parse: [] },
              attachments: file === undefined ? [] : [{ id: "0", filename: file.filename }],
            },
            ...upload(file),
            signal: AbortSignal.timeout(30_000),
          });
          return undefined;
        },
        catch: toDiscordError("edit discord message"),
      }),

    /**
     * Take the controls off a message without touching what it says.
     *
     * `content` is omitted from the body rather than sent as `""` — Discord
     * leaves an absent field alone, and the text here is a record of a decision
     * that something else already wrote.
     */
    clearComponents: async (
      channelId: string,
      messageId: string,
    ): Promise<Result<undefined, DiscordError>> =>
      Result.tryPromise({
        try: async () => {
          await rest.patch(`/channels/${channelId}/messages/${messageId}`, {
            body: { components: [] },
            signal: AbortSignal.timeout(30_000),
          });
          return undefined;
        },
        catch: toDiscordError("clear discord message components"),
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
  };
}

export type DiscordRest = ReturnType<typeof createDiscordRest>;
