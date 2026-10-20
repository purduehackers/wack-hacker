import "./fixtures/catalog-environment.ts";
import { expect, spyOn, test } from "bun:test";

import { getRedis } from "@repo/shared/redis";

import { env } from "../../agent/env.ts";
import { recordUsageTelemetry } from "../../agent/lib/policy/usage-telemetry.ts";
import * as telemetry from "../../agent/lib/telemetry.ts";
import { usageContext, usageEvent } from "./fixtures/usage-context.ts";

test("child hooks retain token, cache, cost and parent turn accounting", async () => {
  const count = spyOn(telemetry, "countAgentEvent").mockImplementation(() => {});
  const distribute = spyOn(telemetry, "distributeAgentEvent").mockImplementation(() => {});
  const persist = spyOn(getRedis({ url: env.REDIS_URL }), "eval").mockResolvedValue(18);
  try {
    await recordUsageTelemetry(usageEvent(), usageContext());
    for (const [direction, tokens] of [
      ["input", 11],
      ["output", 7],
      ["cache_read", 5],
      ["cache_write", 3],
    ]) {
      expect(count).toHaveBeenCalledWith(
        "agent.tokens",
        { delegate: "discord", direction },
        tokens,
      );
    }
    expect(distribute).toHaveBeenCalledWith("agent.cost", 0.02, "none", { delegate: "discord" });
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls.map(([, keys, argv]) => ({ keys, argv }))).toEqual([
      {
        keys: [
          "agent:turn-tokens:usage-child:child-turn",
          "agent:turn-tokens:usage-child:child-turn:events",
        ],
        argv: [18, 86_400, "usage-event"],
      },
      {
        keys: [
          "agent:turn-tokens:usage-parent:parent-turn",
          "agent:turn-tokens:usage-parent:parent-turn:events",
        ],
        argv: [18, 86_400, "usage-event"],
      },
    ]);
    persist.mockRejectedValue(new Error("Redis unavailable"));
    await recordUsageTelemetry(usageEvent(), usageContext());
    expect(count).toHaveBeenCalledWith("agent.turn_token_accounting", { status: "unavailable" });
  } finally {
    count.mockRestore();
    distribute.mockRestore();
    persist.mockRestore();
  }
});

test.skipIf(process.env["REDIS_TEST_URL"] === undefined)(
  "replayed usage events deduplicate child and parent totals in Redis",
  async () => {
    const child = Bun.spawn(
      [process.execPath, new URL("./fixtures/usage-redis.ts", import.meta.url).pathname],
      {
        env: { ...process.env, REDIS_URL: process.env["REDIS_TEST_URL"] },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain("usage Redis replay passed");
  },
);
