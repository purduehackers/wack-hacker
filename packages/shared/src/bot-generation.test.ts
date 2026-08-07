import { describe, expect, test } from "bun:test";

import {
  activeBotGenerationSchema,
  type ActiveBotGenerationReader,
  BOT_ACTIVE_GENERATION_KEY,
  decodeActiveBotGeneration,
  readActiveBotGeneration,
} from "./bot-generation.ts";

const DIGEST = "a".repeat(64);
const valid = {
  version: 1,
  generation: 4,
  sandboxName: "bot-4",
  commandId: "command-4",
  image: `vcr.vercel.com/team/bot@sha256:${DIGEST}`,
  healthUrl: "https://bot-4.example.test/health",
  activatedAt: "2026-08-07T12:00:00.000Z",
  expiresAt: "2026-08-08T12:00:00.000Z",
} as const;

describe("active bot generation contract", () => {
  test("decodes object and serialized records while allowing additive fields", () => {
    expect(decodeActiveBotGeneration(valid)).toEqual(valid);
    expect(decodeActiveBotGeneration(JSON.stringify(valid))).toEqual(valid);
    expect(decodeActiveBotGeneration({ ...valid, future: "ignored" })).toEqual(valid);
  });

  test("models an absent active generation", () => {
    expect(decodeActiveBotGeneration(undefined)).toBeUndefined();
    expect(decodeActiveBotGeneration(JSON.parse("null"))).toBeUndefined();
  });

  test.each([
    ["malformed JSON", "{"],
    ["wrong version", { ...valid, version: 2 }],
    ["zero fence", { ...valid, generation: 0 }],
    ["fractional fence", { ...valid, generation: 1.5 }],
    ["unsafe fence", { ...valid, generation: Number.MAX_SAFE_INTEGER + 1 }],
    ["empty sandbox", { ...valid, sandboxName: "" }],
    ["empty command", { ...valid, commandId: "" }],
    ["mutable image tag", { ...valid, image: "vcr.vercel.com/team/bot:latest" }],
    ["HTTP health URL", { ...valid, healthUrl: "http://bot.example.test/health" }],
    [
      "credentialed health URL",
      { ...valid, healthUrl: "https://user:secret@bot.example.test/health" },
    ],
    ["queried health URL", { ...valid, healthUrl: "https://bot.example.test/health?token=x" }],
    ["fragmented health URL", { ...valid, healthUrl: "https://bot.example.test/health#x" }],
    ["wrong health path", { ...valid, healthUrl: "https://bot.example.test/ready" }],
    ["non-ISO activation", { ...valid, activatedAt: "tomorrow" }],
    ["non-ISO expiry", { ...valid, expiresAt: "tomorrow" }],
  ])("rejects %s", (_label, candidate) => {
    expect(() => decodeActiveBotGeneration(candidate)).toThrow();
  });

  test("reads the production key through the narrow Redis port", async () => {
    const requested: unknown[] = [];
    // oxlint-disable-next-line typescript/consistent-type-assertions -- Upstash's generic get cannot be implemented by a fixture with one concrete value.
    const get = (async (key: string) => {
      requested.push(key);
      return JSON.stringify(valid);
    }) as ActiveBotGenerationReader["get"];
    const active = await readActiveBotGeneration({ get });
    expect(requested).toEqual([BOT_ACTIVE_GENERATION_KEY]);
    expect(active).toEqual(valid);
  });

  test("the schema output is the canonical stripped record", () => {
    expect(activeBotGenerationSchema.parse({ ...valid, future: true })).toEqual(valid);
  });
});
