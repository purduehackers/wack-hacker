import { expect, test } from "bun:test";

import { messageOf, Transient } from "./errors.ts";

/**
 * `messageOf` replaced two dozen hand-written copies of
 * `x instanceof Error ? x.message : String(x)`. It has to agree with that
 * expression on every shape those call sites could receive.
 */
test("agrees with the expression it replaced", () => {
  const cases: readonly unknown[] = [
    new Error("plain"),
    new TypeError("subclass"),
    new Transient({ operation: "probe", detail: "tagged" }),
    "a bare string",
    42,
    undefined,
    // eslint-disable-next-line unicorn/no-null -- one of the shapes a catch can see
    null,
    { toString: () => "custom" },
  ];

  for (const value of cases) {
    const handRolled = value instanceof Error ? value.message : String(value);
    expect(messageOf(value)).toBe(handRolled);
  }
});
