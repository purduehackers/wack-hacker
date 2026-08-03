import { Result } from "@repo/shared/result";
import { expect, test } from "vitest";

import { PrivacyMode, PrivacyProject, createPrivacyClient, isPrivacyMode } from "./privacy.ts";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
  readonly authorization: string | undefined;
}

/** Records requests and replies with a queued sequence of responses. */
function fakeFetch(responses: readonly Response[]): {
  readonly calls: Call[];
  readonly impl: typeof fetch;
} {
  const calls: Call[] = [];
  let index = 0;
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      authorization: headers.get("Authorization") ?? undefined,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response ?? new Response("", { status: 500 });
  };
  // oxlint-disable-next-line typescript/consistent-type-assertions -- narrowing a test impl to the fetch signature
  return { calls, impl: impl as unknown as typeof fetch };
}

const PREFS = {
  user_id: "u1",
  mode: PrivacyMode.OptOutPrivacy,
  overrides: { ships: PrivacyMode.OptIn },
};

test("preferences are validated, not blind-cast", async () => {
  const { impl } = fakeFetch([Response.json(PREFS)]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isOk(prefs)).toBe(true);
  expect(Result.isOk(prefs) && prefs.value.mode).toBe(PrivacyMode.OptOutPrivacy);
});

test("a payload the service changed is an InvalidInput, not an undefined in a message", async () => {
  const { impl } = fakeFetch([Response.json({ user_id: "u1", mode: "brand_new_mode" })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isError(prefs) && prefs.error._tag).toBe("InvalidInput");
});

test("the api key is sent as a bearer token", async () => {
  const { calls, impl } = fakeFetch([Response.json(PREFS)]);
  const client = createPrivacyClient({ apiKey: "super-secret", fetchImpl: impl });

  await client.getPreferences("u1");

  expect(calls[0]?.authorization).toBe("Bearer super-secret");
});

test("a 404 is an UpstreamError and is not retried", async () => {
  const { calls, impl } = fakeFetch([new Response("nope", { status: 404 })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isError(prefs) && prefs.error._tag).toBe("UpstreamError");
  expect(calls).toHaveLength(1);
});

test("a 500 is Transient and therefore retried", async () => {
  const { calls, impl } = fakeFetch([new Response("boom", { status: 500 })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isError(prefs) && prefs.error._tag).toBe("Transient");
  // upstreamRetry allows two retries after the first attempt.
  expect(calls.length).toBeGreaterThan(1);
});

test("a 429 is RateLimited", async () => {
  const { impl } = fakeFetch([new Response("slow down", { status: 429 })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isError(prefs) && prefs.error._tag).toBe("RateLimited");
});

test("a transient failure that later succeeds returns the value", async () => {
  const { impl } = fakeFetch([new Response("boom", { status: 500 }), Response.json(PREFS)]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const prefs = await client.getPreferences("u1");

  expect(Result.isOk(prefs)).toBe(true);
});

test("writes send the mode and reason and tolerate an empty response body", async () => {
  const { calls, impl } = fakeFetch([new Response(undefined, { status: 204 })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  const updated = await client.setGlobalMode("u1", PrivacyMode.OptIn, "because");

  // An empty 204 must not be parsed as JSON.
  expect(Result.isOk(updated)).toBe(true);
  expect(calls[0]?.method).toBe("PUT");
  expect(calls[0]?.body).toBe(JSON.stringify({ mode: "opt_in", reason: "because" }));
});

test("project routes are scoped by project id", async () => {
  const { calls, impl } = fakeFetch([new Response(undefined, { status: 204 })]);
  const client = createPrivacyClient({ apiKey: "k", fetchImpl: impl });

  await client.removeProjectOverride("u1", PrivacyProject.Ships);

  expect(calls[0]?.method).toBe("DELETE");
  expect(calls[0]?.url).toContain("/preferences/u1/ships");
});

test("mode narrowing rejects anything off-contract", () => {
  expect(isPrivacyMode("opt_in")).toBe(true);
  expect(isPrivacyMode("OPT_IN")).toBe(false);
  expect(isPrivacyMode("deleted")).toBe(false);
});
