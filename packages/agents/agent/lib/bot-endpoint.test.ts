import { describe, expect, test } from "bun:test";

import {
  BOT_ACTIVE_GENERATION_KEY,
  type ActiveBotGenerationReader,
} from "@repo/shared/bot-generation";

import { resolveBotBaseUrl } from "./bot-endpoint.ts";

const active = {
  version: 1,
  generation: 4,
  sandboxName: "bot-4",
  commandId: "command-4",
  image: `vcr.vercel.com/team/bot@sha256:${"a".repeat(64)}`,
  healthUrl: "https://bot-4.example.test/health",
  activatedAt: "2026-08-07T12:00:00.000Z",
  expiresAt: "2026-08-08T12:00:00.000Z",
} as const;

function reader(raw: unknown): ActiveBotGenerationReader {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- Upstash's generic get cannot be implemented by a fixture with one concrete value.
  const get = (async (key: string) => {
    expect(key).toBe(BOT_ACTIVE_GENERATION_KEY);
    return raw;
  }) as ActiveBotGenerationReader["get"];
  return { get };
}

describe("active bot endpoint", () => {
  test("uses the fallback only when no generation is active", async () => {
    expect(await resolveBotBaseUrl(reader(undefined), "https://fallback.example.test")).toBe(
      "https://fallback.example.test",
    );
  });

  test("resolves the canonical active health origin", async () => {
    expect(
      await resolveBotBaseUrl(
        reader(active),
        "https://fallback.example.test",
        new Date("2026-08-07T13:00:00.000Z"),
      ),
    ).toBe("https://bot-4.example.test/");
  });

  test("fails closed for expired or decorated records", async () => {
    expect(
      resolveBotBaseUrl(
        reader(active),
        "https://fallback.example.test",
        new Date(active.expiresAt),
      ),
    ).rejects.toThrow("active bot Sandbox generation has expired");
    expect(
      resolveBotBaseUrl(
        reader({ ...active, healthUrl: `${active.healthUrl}?credential=leak` }),
        "https://fallback.example.test",
      ),
    ).rejects.toThrow();
  });
});
