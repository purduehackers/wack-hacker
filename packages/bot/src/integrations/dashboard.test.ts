import { Result } from "@repo/shared/result";
import { expect, test } from "vitest";

import { createDashboardWriter, edgeConfigIdFrom } from "./dashboard.ts";

const CONNECTION = "https://edge-config.vercel.com/ecfg_abc123?token=tok_xyz";

function fakeFetch(response: Response): {
  readonly calls: { url: string; method: string; body: string | undefined }[];
  readonly impl: typeof fetch;
} {
  const calls: { url: string; method: string; body: string | undefined }[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return response;
  };
  // oxlint-disable-next-line typescript/consistent-type-assertions -- narrowing a test impl to the fetch signature
  return { calls, impl: impl as unknown as typeof fetch };
}

test("the edge config id is parsed out of the connection string", () => {
  const id = edgeConfigIdFrom(CONNECTION);

  expect(Result.isOk(id) && id.value).toBe("ecfg_abc123");
});

test("a malformed connection string fails at construction, not at use", () => {
  // Otherwise the first failure would land mid-hack-night, when an organizer
  // runs the command and nothing happens.
  const writer = createDashboardWriter({
    vercelToken: "t",
    connectionString: "not-a-connection-string",
  });

  expect(Result.isError(writer)).toBe(true);
});

test("setVersion upserts the version key", async () => {
  const { calls, impl } = fakeFetch(Response.json({ status: "ok" }));
  const writer = createDashboardWriter({
    vercelToken: "tok",
    connectionString: CONNECTION,
    fetchImpl: impl,
  });
  expect(Result.isOk(writer)).toBe(true);
  if (!Result.isOk(writer)) return;

  const outcome = await writer.value.setVersion("6.17");

  expect(Result.isOk(outcome)).toBe(true);
  expect(calls[0]?.method).toBe("PATCH");
  expect(calls[0]?.url).toContain("/v1/edge-config/ecfg_abc123/items");
  expect(calls[0]?.body).toBe(
    JSON.stringify({ items: [{ operation: "upsert", key: "version", value: "6.17" }] }),
  );
});

test("a 403 is an UpstreamError, because a bad token will not fix itself", async () => {
  const { calls, impl } = fakeFetch(new Response("forbidden", { status: 403 }));
  const writer = createDashboardWriter({
    vercelToken: "bad",
    connectionString: CONNECTION,
    fetchImpl: impl,
  });
  if (!Result.isOk(writer)) throw new Error("writer should have been constructed");

  const outcome = await writer.value.setVersion("6.17");

  expect(Result.isError(outcome) && outcome.error._tag).toBe("UpstreamError");
  expect(calls).toHaveLength(1);
});

test("a 502 is Transient and retried", async () => {
  const { calls, impl } = fakeFetch(new Response("bad gateway", { status: 502 }));
  const writer = createDashboardWriter({
    vercelToken: "tok",
    connectionString: CONNECTION,
    fetchImpl: impl,
  });
  if (!Result.isOk(writer)) throw new Error("writer should have been constructed");

  const outcome = await writer.value.setVersion("6.17");

  expect(Result.isError(outcome) && outcome.error._tag).toBe("Transient");
  expect(calls.length).toBeGreaterThan(1);
});
