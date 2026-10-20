import { afterAll, beforeAll, expect, test } from "bun:test";

import { closeRedis, getRedis, type RedisClient } from "../redis/client.ts";
import { Result } from "../result/index.ts";
import { executionKey, dispatchExecutionKey, resetKey } from "./keys.ts";
import type { ExecutionBinding } from "./records/execution.ts";
import { createConversationStore } from "./store.ts";

const url = process.env["REDIS_TEST_URL"];

let redis: RedisClient;
const keys: string[] = [];
const address = () => {
  const continuation = String(
    100000000000000000n + BigInt(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0),
  );
  keys.push(executionKey(continuation), resetKey(continuation));
  return continuation;
};
const candidate = (id: string): ExecutionBinding => ({
  version: 1,
  generation: crypto.randomUUID(),
  identity: { id, projectId: "test-project", runtime: "eve-0.81.1", sandbox: "durable-bash-v1" },
  originHash: "a".repeat(64),
});
beforeAll(() => {
  if (url === undefined) return;
  redis = getRedis({ url });
});
afterAll(async () => {
  if (keys.length > 0) await redis.del(...keys);
  await closeRedis();
});

test.skipIf(url === undefined)(
  "concurrent conflicting deployment selections have one persistent winner across restart",
  async () => {
    const continuation = address();
    const store = createConversationStore({ redis });
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        store.execution.bind(continuation, candidate(`deployment-${index}`)),
      ),
    );
    const winner = results[0];
    if (winner === undefined || Result.isError(winner) || winner.value === undefined)
      throw new Error("binding missing");
    for (const outcome of results) expect(outcome).toEqual(winner);
    expect(await redis.pttl(executionKey(continuation))).toBe(-1);
    const restarted = createConversationStore({ redis });
    expect(await restarted.executions.read(continuation)).toEqual(winner);
    expect(await restarted.execution.bind(continuation, candidate("rollback"))).toEqual(winner);
  },
);

test.skipIf(url === undefined)(
  "session confirmation refuses conflicting IDs and stale generations",
  async () => {
    const continuation = address();
    const dispatchId = crypto.randomUUID();
    keys.push(dispatchExecutionKey(dispatchId));
    const binding = candidate("candidate");
    const store = createConversationStore({ redis });
    await store.execution.bind(continuation, binding);
    await store.execution.pinDispatch(continuation, dispatchId);
    expect(
      await store.execution.confirmSession(continuation, dispatchId, binding.generation, "one"),
    ).toBe(true);
    expect(
      await store.execution.confirmSession(continuation, dispatchId, binding.generation, "two"),
    ).toBe(false);
    expect(
      await store.execution.confirmSession(continuation, dispatchId, crypto.randomUUID(), "one"),
    ).toBe(false);
    const restored = await store.executions.dispatch(dispatchId);
    expect(Result.isOk(restored) && restored.value?.sessionId).toBe("one");
  },
);

test.skipIf(url === undefined)(
  "explicit reset preserves deployment, rotates generation and rejects late old confirmations",
  async () => {
    const continuation = address();
    const dispatchId = crypto.randomUUID();
    keys.push(dispatchExecutionKey(dispatchId));
    const binding = candidate("retained");
    const store = createConversationStore({ redis });
    await store.execution.bind(continuation, binding);
    await store.execution.pinDispatch(continuation, dispatchId);
    await store.execution.confirmSession(
      continuation,
      dispatchId,
      binding.generation,
      "old-session",
    );
    const resetId = crypto.randomUUID();
    expect(await store.execution.retireSession(continuation, resetId, binding.generation)).toBe(
      false,
    );
    await redis.set(resetKey(continuation), resetId, { ex: 60 });
    expect(await store.execution.retireSession(continuation, resetId, binding.generation)).toBe(
      true,
    );
    expect(await store.execution.retireSession(continuation, resetId, binding.generation)).toBe(
      true,
    );
    expect(
      await store.execution.confirmSession(
        continuation,
        dispatchId,
        binding.generation,
        "old-session",
      ),
    ).toBe(false);
    const result = await store.executions.read(continuation);
    if (Result.isError(result)) throw result.error;
    expect(result.value).toEqual({ ...binding, generation: resetId });
    const oldDispatch = await store.executions.dispatch(dispatchId);
    expect(Result.isOk(oldDispatch) && oldDispatch.value?.sessionId).toBe("old-session");
  },
);

test.skipIf(url === undefined)(
  "corrupt bindings fail closed rather than being replaced",
  async () => {
    const continuation = address();
    await redis.set(executionKey(continuation), "corrupt");
    const store = createConversationStore({ redis });
    expect(Result.isError(await store.executions.read(continuation))).toBe(true);
    expect(Result.isError(await store.execution.bind(continuation, candidate("candidate")))).toBe(
      true,
    );
    expect(await redis.get(executionKey(continuation))).toBe("corrupt");
  },
);
