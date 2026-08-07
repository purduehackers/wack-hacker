/** HTTP client for the authenticated semantic bot command seam. */

import {
  decodeDiscordCommandResponse,
  DISCORD_COMMAND_INPUT_SCHEMAS,
  DISCORD_COMMAND_ROUTE,
  type DiscordCommandOperation,
} from "@repo/shared/discord-command-wire";
import { InvalidInput, RateLimited, Transient, UpstreamError } from "@repo/shared/errors";
import { getRedis } from "@repo/shared/redis";
import { Result } from "@repo/shared/result";
import type { z } from "zod";

import { resolveBotBaseUrl } from "../../../lib/bot-endpoint.ts";
import { env } from "../../../lib/env.ts";

type BotCommandError = InvalidInput | RateLimited | Transient | UpstreamError;

function commandError(operation: DiscordCommandOperation) {
  return (cause: unknown): BotCommandError => {
    if (
      cause instanceof InvalidInput ||
      cause instanceof RateLimited ||
      cause instanceof Transient ||
      cause instanceof UpstreamError
    )
      return cause;
    return new Transient({
      operation: `call bot Discord ${operation}`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  };
}

export function createDiscordCommandClient(deps: {
  readonly baseUrl: string | (() => Promise<string>);
  readonly secret: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return async <K extends DiscordCommandOperation>(
    operation: K,
    input: z.output<(typeof DISCORD_COMMAND_INPUT_SCHEMAS)[K]>,
  ): Promise<Result<unknown, BotCommandError>> =>
    Result.tryPromise({
      try: async () => {
        const baseUrl = typeof deps.baseUrl === "string" ? deps.baseUrl : await deps.baseUrl();
        const response = await doFetch(new URL(DISCORD_COMMAND_ROUTE, baseUrl), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deps.secret}`,
          },
          body: JSON.stringify({ operation, input }),
          signal: AbortSignal.timeout(30_000),
        });
        const raw = await response.json().catch((): unknown => undefined);
        const decoded = decodeDiscordCommandResponse(raw);
        if (Result.isError(decoded)) throw decoded.error;
        if (!decoded.value.ok) {
          const detail = `${decoded.value.error.tag}: ${decoded.value.error.message}`;
          if (response.status === 429)
            throw new RateLimited({ service: "discord", retryAfterMs: 1_000 });
          if (response.status >= 500)
            throw new Transient({ operation: `call bot Discord ${operation}`, detail });
          throw new UpstreamError({ service: "discord", status: response.status, detail });
        }
        if (!response.ok) {
          throw new UpstreamError({
            service: "bot",
            status: response.status,
            detail: "command response status disagreed with its body",
          });
        }
        return decoded.value.data;
      },
      catch: commandError(operation),
    });
}

const redis = getRedis({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
});

export const discordCommand = createDiscordCommandClient({
  baseUrl: () => resolveBotBaseUrl(redis, env.BOT_URL),
  secret: env.BOT_INGRESS_SECRET,
});
