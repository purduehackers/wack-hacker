import { expect, test } from "bun:test";

import { Result } from "@repo/shared/result";

process.env["SKIP_ENV_VALIDATION"] = "1";
process.env["UPSTASH_REDIS_REST_URL"] = "https://redis.example.test";
process.env["UPSTASH_REDIS_REST_TOKEN"] = "redis-token";
process.env["BOT_INGRESS_SECRET"] = "bot-secret";

const { createDiscordCommandClient } = await import("./client.ts");
const { Transient, UpstreamError } = await import("@repo/shared/errors");

function clientReturning(status: number, body: unknown) {
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(url).toBe("https://bot.example.test/internal/discord-command");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret",
    });
    return Response.json(body, { status });
  };
  fetch.preconnect = globalThis.fetch.preconnect;
  return createDiscordCommandClient({
    baseUrl: "https://bot.example.test",
    secret: "secret",
    fetch,
  });
}

test("Discord command client preserves valid operation output and request bytes", async () => {
  const client = clientReturning(200, {
    ok: true,
    data: [
      {
        id: "20000000000000001",
        name: "Organizer",
        color: "#112233",
        position: 1,
        mentionable: true,
        hoist: true,
        managed: false,
        isEveryone: false,
      },
    ],
  });
  const result = await client("list_roles", {});
  expect(Result.isError(result)).toBe(false);
  if (Result.isError(result)) return;
  expect(result.value[0]?.name).toBe("Organizer");
});

test("Discord command client rejects malformed success output as nonretryable upstream failure", async () => {
  const result = await clientReturning(200, { ok: true, data: {} })("list_roles", {});
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  expect(result.error).not.toBeInstanceOf(Transient);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord command client preserves the bot's UpstreamError classification", async () => {
  const result = await clientReturning(502, {
    ok: false,
    error: { tag: "UpstreamError", message: "discord returned malformed data" },
  })("list_roles", {});
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  expect(result.error).not.toBeInstanceOf(Transient);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});

test("Discord command client keeps ordinary service failures transient", async () => {
  const result = await clientReturning(503, {
    ok: false,
    error: { tag: "Transient", message: "gateway is unavailable" },
  })("list_roles", {});
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(Transient);
});

test("Discord command client maps a malformed successful envelope to 502", async () => {
  const result = await clientReturning(200, { unexpected: true })("list_roles", {});
  expect(Result.isError(result)).toBe(true);
  if (!Result.isError(result)) return;
  expect(result.error).toBeInstanceOf(UpstreamError);
  if (!(result.error instanceof UpstreamError)) return;
  expect(result.error.status).toBe(502);
});
