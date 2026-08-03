import { expect, test } from "vitest";

import { InvalidInput, NotFound, RateLimited, Transient } from "../errors.ts";
import { Result } from "./index.ts";
import {
  delayForAttempt,
  quickPolicy,
  retrying,
  retryingPromise,
  upstreamPolicy,
} from "./retry.ts";
import type { RetryDeps } from "./retry.ts";

function fakeDeps(): { deps: RetryDeps; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    deps: {
      sleep: async (ms) => void waits.push(ms),
      random: () => 0.5,
    },
  };
}

test("a non-retryable error fails on the first attempt", async () => {
  const { deps, waits } = fakeDeps();
  let calls = 0;

  const result = await retrying(
    upstreamPolicy,
    async () => {
      calls += 1;
      return Result.err(new NotFound({ kind: "issue", id: "1" }));
    },
    deps,
  );

  // The whole point of shouldRetry: a 404 cannot become a 200.
  expect(calls).toBe(1);
  expect(waits).toEqual([]);
  expect(Result.isError(result)).toBe(true);
});

test("InvalidInput is never retried either", async () => {
  const { deps } = fakeDeps();
  let calls = 0;

  await retrying(
    upstreamPolicy,
    async () => {
      calls += 1;
      return Result.err(new InvalidInput({ subject: "cron", issues: ["bad"] }));
    },
    deps,
  );

  expect(calls).toBe(1);
});

test("a transient error is retried up to the attempt budget", async () => {
  const { deps, waits } = fakeDeps();
  let calls = 0;

  const result = await retrying(
    upstreamPolicy,
    async () => {
      calls += 1;
      return Result.err(new Transient({ operation: "fetch", detail: "ECONNRESET" }));
    },
    deps,
  );

  expect(calls).toBe(upstreamPolicy.attempts);
  expect(waits).toHaveLength(upstreamPolicy.attempts - 1);
  expect(Result.isError(result)).toBe(true);
});

test("retrying stops as soon as an attempt succeeds", async () => {
  const { deps, waits } = fakeDeps();
  let calls = 0;

  const result = await retrying(
    upstreamPolicy,
    async () => {
      calls += 1;
      if (calls < 2)
        return Result.err<string, Transient>(new Transient({ operation: "f", detail: "x" }));
      return Result.ok<string, Transient>("recovered");
    },
    deps,
  );

  expect(calls).toBe(2);
  expect(waits).toHaveLength(1);
  expect(Result.isOk(result) && result.value).toBe("recovered");
});

test("an upstream-advised retryAfterMs overrides the computed backoff", async () => {
  const { deps, waits } = fakeDeps();

  await retrying(
    upstreamPolicy,
    async () => Result.err(new RateLimited({ service: "github", retryAfterMs: 1_234 })),
    deps,
  );

  // Upstream knows better than our backoff curve does.
  expect(waits).toEqual([1_234, 1_234]);
});

test("attempt is passed through so work can vary per try", async () => {
  const { deps } = fakeDeps();
  const seen: number[] = [];

  await retrying(
    quickPolicy,
    async (attempt) => {
      seen.push(attempt);
      return Result.err(new Transient({ operation: "f", detail: "x" }));
    },
    deps,
  );

  expect(seen).toEqual([0, 1]);
});

test("backoff curves grow as documented and stay under the ceiling", () => {
  const policy = { ...upstreamPolicy, jitter: false, baseDelayMs: 100, maxDelayMs: 350 };

  expect([0, 1, 2, 3].map((n) => delayForAttempt(policy, n))).toEqual([100, 200, 350, 350]);
  expect([0, 1, 2].map((n) => delayForAttempt({ ...policy, backoff: "linear" }, n))).toEqual([
    100, 200, 300,
  ]);
  expect([0, 1, 2].map((n) => delayForAttempt({ ...policy, backoff: "constant" }, n))).toEqual([
    100, 100, 100,
  ]);
});

test("jitter spreads the wait across the full window", () => {
  const policy = { ...upstreamPolicy, jitter: true, baseDelayMs: 100, maxDelayMs: 10_000 };

  expect(delayForAttempt(policy, 0, () => 0)).toBe(0);
  expect(delayForAttempt(policy, 0, () => 1)).toBe(100);
  expect(delayForAttempt(policy, 0, () => 0.5)).toBe(50);
});

test("attempts below 1 still run the work exactly once", async () => {
  const { deps } = fakeDeps();
  let calls = 0;

  await retrying(
    { ...upstreamPolicy, attempts: 0 },
    async () => {
      calls += 1;
      return Result.err(new Transient({ operation: "f", detail: "x" }));
    },
    deps,
  );

  expect(calls).toBe(1);
});

test("retryingPromise maps a throw onto a tagged error and retries it", async () => {
  const { deps } = fakeDeps();
  let calls = 0;

  const result = await retryingPromise(
    quickPolicy,
    {
      try: async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      },
      catch: (cause) => new Transient({ operation: "fetch", detail: String(cause) }),
    },
    deps,
  );

  expect(calls).toBe(2);
  expect(Result.isError(result) && result.error._tag).toBe("Transient");
});

test("retryingPromise returns the value once the throw stops", async () => {
  const { deps } = fakeDeps();
  let calls = 0;

  const result = await retryingPromise(
    quickPolicy,
    {
      try: async () => {
        calls += 1;
        if (calls === 1) throw new Error("flaky");
        return "ok";
      },
      catch: () => new Transient({ operation: "fetch", detail: "flaky" }),
    },
    deps,
  );

  expect(Result.isOk(result) && result.value).toBe("ok");
});
