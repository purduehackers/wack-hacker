import { describe, expect, test } from "bun:test";

import type { InteractionPayload } from "@repo/shared/wire";

import { claimInteraction } from "./interaction-receipt.ts";

const interaction: InteractionPayload = {
  continuationKey: "30000000000000000",
  interactionId: "40000000000000000",
  dispatchId: "00000000-0000-4000-8000-000000000000",
  renderRevision: 3,
  requestId: "approval-1",
  authChannelId: "30000000000000000",
  optionId: "approve",
  principal: {
    userId: "10000000000000000",
    username: "member",
    nickname: "Member",
    memberRoles: [],
  },
};

interface ReceiptRedisHarness {
  readonly redis: {
    eval: (
      script: string,
      keys: string[],
      args: unknown[],
    ) => Promise<ReturnType<typeof JSON.parse>>;
  };
  readonly accept: () => void;
  readonly invocations: () => readonly {
    readonly keys: readonly string[];
    readonly args: readonly unknown[];
  }[];
}

function receiptRedis(): ReceiptRedisHarness {
  let stored: Record<string, unknown> | undefined;
  const calls: { readonly keys: readonly string[]; readonly args: readonly unknown[] }[] = [];
  return {
    redis: {
      eval: async (_script, redisKeys, args) => {
        calls.push({ keys: redisKeys, args });
        const forwardingRaw = args[8];
        if (typeof forwardingRaw !== "string") return JSON.parse("-1");
        const candidate: Record<string, unknown> = JSON.parse(forwardingRaw);
        if (stored === undefined) {
          stored = candidate;
          return JSON.parse("1");
        }
        for (const identityField of [
          "dispatchId",
          "renderRevision",
          "requestId",
          "principalId",
          "responseDigest",
          "authChannelId",
          "authThreadId",
        ]) {
          if (stored[identityField] !== candidate[identityField]) return JSON.parse("-1");
        }
        return JSON.parse(stored["status"] === "accepted" ? "2" : "0");
      },
    },
    accept: () => {
      if (stored !== undefined) stored["status"] = "accepted";
    },
    invocations: () => calls,
  };
}

describe("agent interaction admission receipt", () => {
  test("one concurrent delivery wins and an accepted retry receives the durable acknowledgement", async () => {
    const harness = receiptRedis();
    const [first, overlap] = await Promise.all([
      claimInteraction(harness.redis, interaction),
      claimInteraction(harness.redis, interaction),
    ]);

    expect([first.claim, overlap.claim].sort((left, right) => left - right)).toEqual([0, 1]);
    harness.accept();
    expect((await claimInteraction(harness.redis, interaction)).claim).toBe(2);

    const invocation = harness.invocations()[0];
    expect(invocation?.keys).toEqual([
      "agent:render-intent:00000000-0000-4000-8000-000000000000",
      "agent:render-target:00000000-0000-4000-8000-000000000000",
      "agent:interaction-receipt:40000000000000000",
      "agent:reset:30000000000000000",
      "agent:ingress:30000000000000000",
    ]);
    expect(invocation?.args[12]).toBe("40000000000000000");
  });

  test("the same interaction id cannot be replayed with a different answer", async () => {
    const harness = receiptRedis();
    expect((await claimInteraction(harness.redis, interaction)).claim).toBe(1);
    expect(
      (
        await claimInteraction(harness.redis, {
          ...interaction,
          optionId: "deny",
        })
      ).claim,
    ).toBe(-1);
  });
});
