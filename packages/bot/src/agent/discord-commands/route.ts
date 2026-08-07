/** Authenticated HTTP adapter for agent → bot semantic Discord commands. */

import { bearerMatches } from "@repo/shared/bearer";
import {
  decodeDiscordCommand,
  DISCORD_COMMAND_ROUTE,
  type DiscordCommandResponse,
} from "@repo/shared/discord-command-wire";
import { RateLimited, Transient, UpstreamError, serializeError } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";
import type { Client } from "discord.js";

import { executeDiscordCommand } from "./handler.ts";

export { DISCORD_COMMAND_ROUTE };

export async function handleDiscordCommandRequest(
  request: Request,
  deps: { readonly client: Client; readonly ingressSecret: string },
): Promise<Response> {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!bearerMatches(request.headers.get("authorization") ?? undefined, deps.ingressSecret)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!deps.client.isReady()) {
    return failure(
      new Transient({ operation: "execute Discord command", detail: "gateway is not ready" }),
      503,
    );
  }

  const body = await request.json().catch((): unknown => undefined);
  const decoded = decodeDiscordCommand(body);
  if (Result.isError(decoded)) return failure(decoded.error, 400);

  const executed = await executeDiscordCommand(deps.client.rest, decoded.value);
  if (Result.isError(executed)) {
    const error = executed.error;
    const status =
      error instanceof RateLimited
        ? 429
        : error instanceof UpstreamError
          ? normalizeStatus(error.status)
          : 503;
    return failure(error, status);
  }
  const response = { ok: true, data: executed.value } as const satisfies DiscordCommandResponse;
  return Response.json(response);
}

function normalizeStatus(status: number): number {
  return status >= 400 && status <= 599 ? status : 502;
}

function failure(error: unknown, status: number): Response {
  const serialized = serializeError(error);
  const response = {
    ok: false,
    error: { tag: serialized.tag.slice(0, 100), message: serialized.message.slice(0, 1_000) },
  } as const satisfies DiscordCommandResponse;
  return Response.json(response, { status });
}
