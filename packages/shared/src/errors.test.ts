import { Panic, UnhandledException, matchError, panic } from "better-result";
import { expect, test } from "vitest";

import {
  Forbidden,
  InvalidInput,
  InvariantViolated,
  NotFound,
  RateLimited,
  Transient,
  isDefect,
  isRetryable,
  retryAfterMs,
  serializeError,
  tagOf,
} from "./errors.ts";

test("props are readable as direct fields", () => {
  const error = new NotFound({ kind: "skill", id: "issues" });

  expect(error.kind).toBe("skill");
  expect(error.id).toBe("issues");
  expect(error._tag).toBe("NotFound");
});

test("messages are derived, so the same failure always reads the same way", () => {
  expect(new NotFound({ kind: "skill", id: "issues" }).message).toBe("skill not found: issues");
  expect(new InvalidInput({ subject: "cron", issues: ["a", "b"] }).message).toBe(
    "invalid cron: a; b",
  );
  expect(
    new Forbidden({ required: "admin", actual: "public", subject: "list_audit_log" }).message,
  ).toBe('list_audit_log requires role "admin" but caller has "public"');
});

test("errors survive JSON, which a bare Error does not", () => {
  // The trap this guards: Error#message and #stack are non-enumerable, so an
  // untagged error placed in an Err and stringified would arrive empty.
  expect(JSON.stringify(new Error("gone"))).toBe("{}");

  // oxlint-disable-next-line oxclippy/prefer-structured-clone -- structuredClone bypasses toJSON, which is exactly what this exercises
  const round = JSON.parse(JSON.stringify(new NotFound({ kind: "skill", id: "issues" })));
  expect(round._tag).toBe("NotFound");
  expect(round.message).toBe("skill not found: issues");
  expect(round.kind).toBe("skill");
  expect(round.id).toBe("issues");
});

test("the static guard narrows to the concrete class", () => {
  const error: unknown = new RateLimited({ service: "linear", retryAfterMs: 1_000 });

  expect(RateLimited.is(error)).toBe(true);
  expect(NotFound.is(error)).toBe(false);
  if (RateLimited.is(error)) expect(error.retryAfterMs).toBe(1_000);
});

test("matchError is exhaustive over a tagged union", () => {
  const describe = (error: NotFound | Forbidden): string =>
    matchError(error, {
      NotFound: (e) => `missing ${e.kind}`,
      Forbidden: (e) => `need ${e.required}`,
    });

  expect(describe(new NotFound({ kind: "ship", id: "1" }))).toBe("missing ship");
  expect(describe(new Forbidden({ required: "admin", actual: "public", subject: "tool" }))).toBe(
    "need admin",
  );
});

test("an error is directly yieldable, so it composes in Result.gen", () => {
  // TaggedError implements Symbol.iterator for exactly this.
  expect(typeof new NotFound({ kind: "a", id: "b" })[Symbol.iterator]).toBe("function");
});

test("expected failures are not defects; bugs, panics, and raw throws are", () => {
  expect(isDefect(new NotFound({ kind: "ship", id: "1" }))).toBe(false);
  expect(isDefect(new Transient({ operation: "fetch", detail: "reset" }))).toBe(false);

  // Our own contract violated -> our bug, even though it is tagged.
  expect(isDefect(new InvariantViolated({ invariant: "lease-owner", detail: "mismatch" }))).toBe(
    true,
  );
  expect(isDefect(new UnhandledException({ cause: new Error("boom") }))).toBe(true);
  expect(isDefect(new Error("raw"))).toBe(true);
  expect(isDefect("string failure")).toBe(true);
});

test("a Panic is a defect", () => {
  let thrown: unknown;
  try {
    panic("unreachable");
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Panic);
  expect(isDefect(thrown)).toBe(true);
  expect(tagOf(thrown)).toBe("Panic");
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

test("serializeError withholds the stack that toJSON would emit", () => {
  const error = new NotFound({ kind: "skill", id: "issues" });

  // toJSON is fine locally; it carries stack and cause. Anything crossing to
  // another service — or reaching a Discord message — must not.
  expect(JSON.stringify(error)).toContain("stack");
  expect(serializeError(error)).toEqual({ tag: "NotFound", message: "skill not found: issues" });
});

test("serializeError never throws, whatever it is handed", () => {
  expect(serializeError(new Error("boom")).message).toBe("boom");
  expect(serializeError("plain").message).toBe("plain");
  expect(serializeError(undefined).tag).toBe("Defect");
});
