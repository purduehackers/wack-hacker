import { expect, test } from "vitest";

import { InvalidInput, NotFound, RateLimited, Transient, isRetryable } from "../errors.ts";
import { Result } from "./index.ts";
import { exponentialWithJitter, noRetry, quickRetry, upstreamRetry, withSignal } from "./retry.ts";

/**
 * Every policy is passed to a real `Result.tryPromise` here. better-result does
 * not export `RetryConfig`, so `RetryPolicy` mirrors it — these calls are what
 * make that mirror verified rather than assumed.
 */
test("a non-retryable error fails on the first attempt", async () => {
  let calls = 0;

  const result = await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        throw new Error("missing");
      },
      catch: () => new NotFound({ kind: "issue", id: "1" }),
    },
    upstreamRetry,
  );

  // The whole point of shouldRetry: a 404 cannot become a 200.
  expect(calls).toBe(1);
  expect(Result.isError(result)).toBe(true);
});

test("InvalidInput is never retried either", async () => {
  let calls = 0;

  await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        throw new Error("bad");
      },
      catch: () => new InvalidInput({ subject: "cron", issues: ["bad"] }),
    },
    upstreamRetry,
  );

  expect(calls).toBe(1);
});

test("a transient error is retried up to the attempt budget", async () => {
  let calls = 0;

  const result = await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      },
      catch: () => new Transient({ operation: "fetch", detail: "ECONNRESET" }),
    },
    // A zero delay keeps the test fast without stubbing timers.
    { retry: { times: 2, shouldRetry: isRetryable, delayMs: () => 0 } },
  );

  // `times: 2` means two retries after the initial attempt.
  expect(calls).toBe(3);
  expect(Result.isError(result)).toBe(true);
});

test("retrying stops as soon as an attempt succeeds", async () => {
  let calls = 0;

  const result = await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        if (calls < 2) throw new Error("flaky");
        return "recovered";
      },
      catch: () => new Transient({ operation: "f", detail: "flaky" }),
    },
    { retry: { times: 5, shouldRetry: () => true, delayMs: () => 0 } },
  );

  expect(calls).toBe(2);
  expect(Result.isOk(result) && result.value).toBe("recovered");
});

test("an upstream-advised retryAfterMs wins over the backoff curve", () => {
  const delayMs = upstreamRetry.retry?.delayMs;
  const advised = new RateLimited({ service: "github", retryAfterMs: 1_234 });

  expect(delayMs?.(advised, { attempt: 1 })).toBe(1_234);

  // Without advice the curve applies. It is jittered, so only the window is fixed.
  const computed = delayMs?.(new Transient({ operation: "f", detail: "x" }), { attempt: 1 }) ?? -1;
  expect(computed).toBeGreaterThanOrEqual(0);
  expect(computed).toBeLessThanOrEqual(250);
});

test("the attempt counter reaches shouldRetry so a policy can see it", async () => {
  const seen: number[] = [];

  await Result.tryPromise(
    {
      try: async () => {
        throw new Error("x");
      },
      catch: () => new Transient({ operation: "f", detail: "x" }),
    },
    {
      retry: {
        times: 2,
        delayMs: () => 0,
        shouldRetry: (_error, context) => {
          seen.push(context.attempt);
          return true;
        },
      },
    },
  );

  expect(seen).toEqual([1, 2]);
});

test("exponential backoff grows and stays under the ceiling", () => {
  const noJitter = () => 1;

  expect(exponentialWithJitter(1, noJitter)).toBe(250);
  expect(exponentialWithJitter(2, noJitter)).toBe(500);
  expect(exponentialWithJitter(3, noJitter)).toBe(1_000);
  expect(exponentialWithJitter(99, noJitter)).toBe(5_000);
});

test("full jitter spreads the wait across the whole window", () => {
  expect(exponentialWithJitter(1, () => 0)).toBe(0);
  expect(exponentialWithJitter(1, () => 0.5)).toBe(125);
  expect(exponentialWithJitter(1, () => 1)).toBe(250);
});

test("noRetry really does not retry", async () => {
  let calls = 0;

  await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        throw new Error("x");
      },
      catch: () => new Transient({ operation: "f", detail: "x" }),
    },
    noRetry,
  );

  expect(calls).toBe(1);
});

test("quickRetry allows exactly one more attempt", async () => {
  let calls = 0;

  await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        throw new Error("x");
      },
      catch: () => new Transient({ operation: "f", detail: "x" }),
    },
    quickRetry,
  );

  expect(calls).toBe(2);
});

test("an aborted signal stops the retry loop", async () => {
  const controller = new AbortController();
  let calls = 0;

  const result = await Result.tryPromise(
    {
      try: async () => {
        calls += 1;
        controller.abort();
        throw new Error("x");
      },
      catch: () => new Transient({ operation: "f", detail: "x" }),
    },
    withSignal(
      { retry: { times: 5, shouldRetry: () => true, delayMs: () => 0 } },
      controller.signal,
    ),
  );

  // A cancelled turn must not keep burning attempts on an upstream nobody is
  // waiting for.
  expect(calls).toBe(1);
  expect(Result.isError(result)).toBe(true);
});

test("withSignal leaves the rest of the policy intact", () => {
  const controller = new AbortController();
  const combined = withSignal(upstreamRetry, controller.signal);

  expect(combined.signal).toBe(controller.signal);
  expect(combined.retry?.times).toBe(upstreamRetry.retry?.times);
});
