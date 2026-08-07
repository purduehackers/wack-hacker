import { describe, expect, test } from "bun:test";

import { createHitlStore, type HitlClaimInput } from "./store.ts";

const approval: HitlClaimInput = {
  dispatchId: "00000000-0000-4000-8000-000000000000",
  continuationKey: "30000000000000000",
  revision: 2,
  requestIndex: 0,
  requestId: "approval-1",
  recipientUserId: "10000000000000000",
  interactionId: "40000000000000000",
};

function hitlRedis() {
  let reset = false;
  let stored: Record<string, unknown> | undefined;
  return {
    redis: {
      eval: async (_script: string, keys: string[], args: unknown[]) => {
        if (keys.length === 1) {
          const current = stored;
          if (
            current === undefined ||
            current["interactionId"] !== args[0] ||
            current["revision"] !== Number(args[1])
          ) {
            return JSON.parse("0");
          }
          current["status"] = "accepted";
          return JSON.parse("1");
        }
        if (reset) return JSON.parse("-1");
        const raw = args[4];
        if (typeof raw !== "string") return JSON.parse("-1");
        const candidate: Record<string, unknown> = JSON.parse(raw);
        if (stored !== undefined && Number(stored["revision"]) >= Number(args[0])) {
          return JSON.parse("0");
        }
        stored = candidate;
        return JSON.parse("1");
      },
    },
    installReset: () => {
      reset = true;
    },
  };
}

describe("bot HITL approval claim", () => {
  test("atomically admits one of two concurrent answers and fences completion to the winner", async () => {
    const harness = hitlRedis();
    const store = createHitlStore(harness.redis);
    const outcomes = await Promise.all([
      store.claim(approval),
      store.claim({ ...approval, interactionId: "40000000000000001" }),
    ]);

    expect(outcomes.sort()).toEqual(["acquired", "claimed"]);
    expect(
      await store.complete(approval.dispatchId, approval.revision, approval.interactionId),
    ).toBe(true);
    expect(await store.complete(approval.dispatchId, approval.revision, "40000000000000001")).toBe(
      false,
    );
  });

  test("a reset barrier makes an otherwise current control stale", async () => {
    const harness = hitlRedis();
    harness.installReset();
    const store = createHitlStore(harness.redis);

    expect(await store.claim(approval)).toBe("stale");
  });
});
