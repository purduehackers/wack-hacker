import { afterEach, expect, test, vi } from "vitest";

const COMPLETE = {
  DISCORD_BOT_TOKEN: "token",
  DISCORD_BOT_CLIENT_ID: "client",
  AGENT_URL: "https://agent.example.com",
  AGENT_INGRESS_SECRET: "inbound",
  BOT_INGRESS_SECRET: "outbound",
  UPSTASH_REDIS_REST_URL: "https://redis.example.com",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
} as const;

/** Loads a fresh copy of the module against a stubbed environment. */
async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...COMPLETE, ...overrides })) {
    vi.stubEnv(key, value);
  }
  vi.stubEnv("SKIP_ENV_VALIDATION", undefined);
  return import("./env.ts");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("a complete environment validates", async () => {
  const { env } = await loadEnv();

  expect(env.DISCORD_BOT_TOKEN).toBe("token");
  expect(env.AGENT_URL).toBe("https://agent.example.com");
});

test("PORT defaults so a host that does not inject one still boots", async () => {
  const { env } = await loadEnv({ PORT: undefined });

  expect(env.PORT).toBe(8080);
});

test("PORT is coerced from the string every host actually supplies", async () => {
  const { env } = await loadEnv({ PORT: "3000" });

  // process.env values are strings; a number-typed port must not be NaN.
  expect(env.PORT).toBe(3000);
  expect(typeof env.PORT).toBe("number");
});

test("a missing required secret fails loudly at load, not later in a handler", async () => {
  await expect(loadEnv({ DISCORD_BOT_TOKEN: undefined })).rejects.toThrow();
});

test("an empty string is treated as unset, so a blank .env line cannot satisfy a secret", async () => {
  await expect(loadEnv({ AGENT_INGRESS_SECRET: "" })).rejects.toThrow();
});

test("a malformed URL is rejected rather than reaching a fetch call", async () => {
  await expect(loadEnv({ AGENT_URL: "agent.example.com" })).rejects.toThrow();
});

test("the two seam secrets are independent", async () => {
  // Deliberately distinct: a leaked inbound bearer must not also grant the
  // ability to impersonate the agent calling back.
  const { env } = await loadEnv();

  expect(env.AGENT_INGRESS_SECRET).not.toBe(env.BOT_INGRESS_SECRET);
  await expect(loadEnv({ BOT_INGRESS_SECRET: undefined })).rejects.toThrow();
});

test("optional observability is genuinely optional", async () => {
  const { env } = await loadEnv({ SENTRY_DSN: undefined });

  expect(env.SENTRY_DSN).toBeUndefined();
});

test("SKIP_ENV_VALIDATION lets tests load the module without credentials", async () => {
  vi.resetModules();
  for (const key of Object.keys(COMPLETE)) vi.stubEnv(key, undefined);
  vi.stubEnv("SKIP_ENV_VALIDATION", "1");

  await expect(import("./env.ts")).resolves.toBeDefined();
});
