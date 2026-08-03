import { TaggedError, UnhandledException } from "better-result";
import { expect, test } from "vitest";

import {
  Forbidden,
  InvalidInput,
  InvariantViolated,
  NotFound,
  RateLimited,
  Transient,
  isAppError,
  isDefect,
  isRetryable,
  retryAfterMs,
  serializeError,
  tagOf,
} from "./errors.ts";

test("errors survive JSON, which a bare Error does not", () => {
  // The trap this guards: Error#message and #stack are non-enumerable, so a
  // TaggedError placed in an Err and stringified would arrive empty.
  expect(JSON.stringify(new Error("gone"))).toBe("{}");

  // oxlint-disable-next-line oxclippy/prefer-structured-clone -- structuredClone bypasses toJSON, which is exactly what this test exercises
  const round = JSON.parse(JSON.stringify(new NotFound({ kind: "skill", id: "issues" })));
  expect(round).toEqual({
    _tag: "NotFound",
    message: "skill not found: issues",
    props: { kind: "skill", id: "issues" },
  });
});

test("props are frozen so an error cannot be mutated after the fact", () => {
  const error = new RateLimited({ service: "linear", retryAfterMs: 1_000 });
  expect(() => {
    Object.assign(error.props, { retryAfterMs: 0 });
  }).toThrow();
  expect(error.props.retryAfterMs).toBe(1_000);
});

test("tagged errors are matched exhaustively on _tag", () => {
  const describe = (error: NotFound | Forbidden): string =>
    TaggedError.match(error, {
      NotFound: (e) => `missing ${e.props.kind}`,
      Forbidden: (e) => `need ${e.props.required}`,
    });

  expect(describe(new NotFound({ kind: "ship", id: "1" }))).toBe("missing ship");
  expect(describe(new Forbidden({ required: "admin", actual: "public" }))).toBe("need admin");
});

test("expected failures are not defects; bugs and raw throws are", () => {
  expect(isDefect(new NotFound({ kind: "ship", id: "1" }))).toBe(false);
  expect(isDefect(new Transient({ operation: "fetch", detail: "reset" }))).toBe(false);

  // Our own contract violated -> our bug, even though it is tagged.
  expect(isDefect(new InvariantViolated({ invariant: "lease-owner", detail: "mismatch" }))).toBe(
    true,
  );
  // Uncaught throw funnelled through better-result.
  expect(isDefect(new UnhandledException({ cause: new Error("boom") }))).toBe(true);
  expect(isDefect(new Error("raw"))).toBe(true);
  expect(isDefect("string failure")).toBe(true);
});

test("only rate limits and transients are retryable", () => {
  expect(isRetryable(new RateLimited({ service: "github", retryAfterMs: 5 }))).toBe(true);
  expect(isRetryable(new Transient({ operation: "post", detail: "ETIMEDOUT" }))).toBe(true);
  expect(isRetryable(new NotFound({ kind: "issue", id: "9" }))).toBe(false);
  expect(isRetryable(new InvalidInput({ subject: "cron", issues: ["bad field"] }))).toBe(false);
});

test("retryAfterMs is only supplied by errors that actually know it", () => {
  expect(retryAfterMs(new RateLimited({ service: "notion", retryAfterMs: 250 }))).toBe(250);
  expect(retryAfterMs(new Transient({ operation: "x", detail: "y" }))).toBeUndefined();
});

test("tagOf collapses unknown values so metric dimensions stay bounded", () => {
  expect(tagOf(new NotFound({ kind: "a", id: "b" }))).toBe("NotFound");
  expect(tagOf(new Error("raw"))).toBe("Defect");
  expect(tagOf({ weird: true })).toBe("Defect");
});

test("serializeError never throws, whatever it is handed", () => {
  expect(serializeError(new Error("boom")).message).toBe("boom");
  expect(serializeError("plain").message).toBe("plain");
  expect(serializeError(undefined)._tag).toBe("Defect");
  expect(isAppError(new Error("boom"))).toBe(false);
});

test("InvalidInput lists every issue so the model can correct itself", () => {
  const error = new InvalidInput({ subject: "wire payload", issues: ["channel.id", "principal"] });
  expect(error.message).toBe("invalid wire payload: channel.id; principal");
});
