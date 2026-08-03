import { expect, test } from "vitest";

import { NotFound, Transient } from "../errors.ts";
import { Result, allOf, fromNullable, partition, partitionAsync, tapError } from "./index.ts";

test("Result is usable as both a type and a value under one name", () => {
  const ok: Result<number, NotFound> = Result.ok(1);
  expect(Result.isOk(ok)).toBe(true);
});

test("tapError fires only on failure and preserves the result", () => {
  const seen: string[] = [];

  const ok = tapError(Result.ok<number, NotFound>(1), (e) => seen.push(e._tag));
  expect(Result.isOk(ok)).toBe(true);
  expect(seen).toEqual([]);

  const failure = new NotFound({ kind: "ship", id: "7" });
  const err = tapError(Result.err<number, NotFound>(failure), (e) => seen.push(e._tag));
  expect(seen).toEqual(["NotFound"]);
  // Identity is preserved: tapError observes, it does not transform.
  expect(Result.isError(err) && err.error).toBe(failure);
});

test("allOf short-circuits on the first error", () => {
  const first = new NotFound({ kind: "a", id: "1" });
  const second = new NotFound({ kind: "b", id: "2" });

  const collected = allOf([Result.ok(1), Result.err<number, NotFound>(first), Result.err(second)]);

  expect(Result.isError(collected)).toBe(true);
  expect(Result.isError(collected) && collected.error).toBe(first);
});

test("allOf preserves order on success", () => {
  const collected = allOf([Result.ok(1), Result.ok(2), Result.ok(3)]);
  expect(Result.isOk(collected) && collected.value).toEqual([1, 2, 3]);
});

test("partition keeps every outcome instead of short-circuiting", () => {
  const { values, errors } = partition([
    Result.ok<number, NotFound>(1),
    Result.err<number, NotFound>(new NotFound({ kind: "a", id: "1" })),
    Result.ok<number, NotFound>(3),
  ]);

  expect(values).toEqual([1, 3]);
  expect(errors).toHaveLength(1);
});

test("partitionAsync captures every outcome and never rejects", async () => {
  const { values, errors } = await partitionAsync([
    Promise.resolve(Result.ok<string, Transient>("part 1")),
    Promise.resolve(
      Result.err<string, Transient>(new Transient({ operation: "chunk", detail: "413" })),
    ),
    Promise.resolve(Result.ok<string, Transient>("part 3")),
  ]);

  expect(values).toEqual(["part 1", "part 3"]);
  expect(errors.map((e) => e._tag)).toEqual(["Transient"]);
});

test("fromNullable absorbs both null and undefined at the boundary", () => {
  const absent = () => new NotFound({ kind: "principal", id: "current" });

  expect(Result.isOk(fromNullable("value", absent))).toBe(true);
  // Both framework absence shapes must be absorbed. `null` comes via JSON.parse
  // so the literal never appears in our source, satisfying unicorn/no-null.
  expect(Result.isError(fromNullable(undefined, absent))).toBe(true);
  expect(Result.isError(fromNullable(JSON.parse("null"), absent))).toBe(true);
});

test("fromNullable keeps falsy-but-present values", () => {
  const absent = () => new NotFound({ kind: "count", id: "x" });
  const zero = fromNullable(0, absent);
  const empty = fromNullable("", absent);

  expect(Result.isOk(zero) && zero.value).toBe(0);
  expect(Result.isOk(empty) && empty.value).toBe("");
});
