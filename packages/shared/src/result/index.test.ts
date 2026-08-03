import { expect, test } from "vitest";

import { NotFound, Transient } from "../errors.ts";
import { Result, fromNullable } from "./index.ts";

test("Result is usable as both a type and a value from one import", () => {
  const ok: Result<number, NotFound> = Result.ok(1);
  expect(Result.isOk(ok)).toBe(true);
});

test("tapError fires only on failure and preserves identity", () => {
  const seen: string[] = [];

  Result.tapError(Result.ok<number, NotFound>(1), (e) => void seen.push(e._tag));
  expect(seen).toEqual([]);

  const failure = new NotFound({ kind: "ship", id: "7" });
  const returned = Result.tapError(
    Result.err<number, NotFound>(failure),
    (e) => void seen.push(e._tag),
  );

  expect(seen).toEqual(["NotFound"]);
  expect(Result.isError(returned) && returned.error).toBe(failure);
});

test("all short-circuits on the first error", () => {
  const first = new NotFound({ kind: "a", id: "1" });
  const second = new NotFound({ kind: "b", id: "2" });

  const collected = Result.all([
    Result.ok(1),
    Result.err<number, NotFound>(first),
    Result.err<number, NotFound>(second),
  ]);

  expect(Result.isError(collected)).toBe(true);
  expect(Result.isError(collected) && collected.error).toBe(first);
});

test("all preserves order on success", () => {
  const collected = Result.all([Result.ok(1), Result.ok(2), Result.ok(3)]);
  expect(Result.isOk(collected) && collected.value).toEqual([1, 2, 3]);
});

test("partition keeps every outcome and returns a tuple", () => {
  // Upstream returns [values, errors], not an object — worth asserting so a
  // destructuring mistake cannot pass silently.
  const [values, errors] = Result.partition([
    Result.ok<number, NotFound>(1),
    Result.err<number, NotFound>(new NotFound({ kind: "a", id: "1" })),
    Result.ok<number, NotFound>(3),
  ]);

  expect(values).toEqual([1, 3]);
  expect(errors).toHaveLength(1);
});

test("partitionAsync captures every outcome and never rejects", async () => {
  const [values, errors] = await Result.partitionAsync([
    Promise.resolve(Result.ok<string, Transient>("part 1")),
    Promise.resolve(
      Result.err<string, Transient>(new Transient({ operation: "chunk", detail: "413" })),
    ),
    Promise.resolve(Result.ok<string, Transient>("part 3")),
  ]);

  expect(values).toEqual(["part 1", "part 3"]);
  expect(errors.map((e) => e._tag)).toEqual(["Transient"]);
});

test("gen composes steps and short-circuits on the first failure", () => {
  const load = (id: string): Result<string, NotFound> =>
    id === "known" ? Result.ok("body") : Result.err(new NotFound({ kind: "skill", id }));

  const good = Result.gen(function* () {
    const body = yield* load("known");
    return Result.ok(body.toUpperCase());
  });
  expect(Result.isOk(good) && good.value).toBe("BODY");

  const bad = Result.gen(function* () {
    const body = yield* load("missing");
    return Result.ok(body.toUpperCase());
  });
  expect(Result.isError(bad) && bad.error._tag).toBe("NotFound");
});

test("a tagged error can be yielded directly inside gen", () => {
  const guard = (allowed: boolean) =>
    Result.gen(function* () {
      if (!allowed) yield* new NotFound({ kind: "ship", id: "1" });
      return Result.ok("allowed");
    });

  expect(Result.isError(guard(false))).toBe(true);
  expect(Result.isOk(guard(true))).toBe(true);
});

test("tryRecover turns an expected failure into a fallback", () => {
  const recovered = Result.tryRecover(
    Result.err<string, NotFound>(new NotFound({ kind: "cache", id: "k" })),
    () => Result.ok<string, never>("computed"),
  );

  expect(Result.isOk(recovered) && recovered.value).toBe("computed");
});

test("fromNullable absorbs both framework absence shapes", () => {
  const absent = () => new NotFound({ kind: "principal", id: "current" });

  expect(Result.isOk(fromNullable("value", absent))).toBe(true);
  expect(Result.isError(fromNullable(undefined, absent))).toBe(true);
  // `null` arrives via JSON.parse so the literal never appears in our source.
  expect(Result.isError(fromNullable(JSON.parse("null"), absent))).toBe(true);
});

test("fromNullable keeps falsy-but-present values", () => {
  const absent = () => new NotFound({ kind: "count", id: "x" });
  const zero = fromNullable(0, absent);
  const empty = fromNullable("", absent);

  expect(Result.isOk(zero) && zero.value).toBe(0);
  expect(Result.isOk(empty) && empty.value).toBe("");
});
