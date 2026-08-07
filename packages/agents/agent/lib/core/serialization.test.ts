import { describe, expect, test } from "bun:test";

import { InvariantViolated } from "@repo/shared/errors";
import { Result } from "@repo/shared/result";

import {
  assertJsonValue,
  assertStateValue,
  assertToolOutput,
  guardToolExecution,
} from "./serialization.ts";

class Box {
  readonly value = 1;
}

const rejectedValues: readonly [string, () => unknown][] = [
  ["class instance", () => new Box()],
  ["Date", () => new Date("2026-01-01T00:00:00.000Z")],
  ["Map", () => new Map([["key", "value"]])],
  ["Set", () => new Set(["value"])],
  ["successful Result", () => Result.ok({ value: 1 })],
  ["failed Result", () => Result.err(new Error("nope"))],
  ["undefined", () => undefined],
  ["NaN", () => Number.NaN],
  ["positive infinity", () => Number.POSITIVE_INFINITY],
  ["negative infinity", () => Number.NEGATIVE_INFINITY],
  ["negative zero", () => -0],
  ["bigint", () => 1n],
  ["undefined object property", () => ({ missing: undefined })],
  [
    "sparse array",
    () => {
      const value: unknown[] = [];
      value.length = 1;
      return value;
    },
  ],
  [
    "extra array property",
    () => {
      const value: unknown[] & { extra?: boolean } = [];
      value.extra = true;
      return value;
    },
  ],
  [
    "symbol array property",
    () => {
      const value: unknown[] = [];
      Reflect.set(value, Symbol("hidden"), true);
      return value;
    },
  ],
  ["non-enumerable array property", () => Object.defineProperty([], "hidden", { value: true })],
  [
    "cycle",
    () => {
      const value: { self?: unknown } = {};
      value.self = value;
      return value;
    },
  ],
];

describe("JSON serialization invariant", () => {
  test("accepts nested plain JSON and preserves its data", () => {
    const value = {
      ok: true,
      // oxlint-disable-next-line unicorn/no-null -- null is a required JSON primitive.
      nested: [1, "two", { three: null }],
    } as const;
    const guarded = assertJsonValue(value);
    expect(guarded).toEqual(value);
    // oxlint-disable-next-line oxclippy/prefer-structured-clone -- exercise the actual JSON boundary.
    expect(JSON.parse(JSON.stringify(guarded))).toEqual(guarded);
    expect(assertToolOutput(value)).toEqual(value);
    expect(assertStateValue(value)).toBe(value);

    const prototypeKey: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    const guardedPrototypeKey = assertJsonValue(prototypeKey);
    expect(JSON.stringify(guardedPrototypeKey)).toBe('{"__proto__":{"polluted":true}}');
  });

  test("preserves strings that happen to contain JSON syntax", () => {
    const value = '{"literal":true}';
    const guarded = assertToolOutput(value);
    expect(guarded).toBe(value);
    // oxlint-disable-next-line oxclippy/prefer-structured-clone -- exercise the actual JSON boundary.
    expect(JSON.parse(JSON.stringify(guarded))).toBe(value);
  });

  for (const [name, create] of rejectedValues) {
    test(`rejects ${name}`, () => {
      expect(() => assertJsonValue(create())).toThrow(InvariantViolated);
    });
  }

  test("guards asynchronous tool execution after every nested return settles", async () => {
    expect(await guardToolExecution(async () => ({ ok: true }))).toEqual({ ok: true });

    let failure: unknown;
    try {
      await guardToolExecution(async () => new Date());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(InvariantViolated);
  });
});
