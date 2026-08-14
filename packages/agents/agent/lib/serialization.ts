/**
 * @fileoverview The guard on Eve's JSON serialization boundary.
 *
 * Tool output and state values must survive `JSON.stringify` without loss.
 * The recursive walk rejects every value the serializer would drop or distort.
 * That covers `undefined`, symbols, non-finite numbers, accessors, class
 * instances, cycles, and `Result` values nobody unwrapped. A rejected value
 * fails with its exact path, so the defect surfaces at the boundary rather
 * than as corrupt state downstream.
 */

import { InvariantViolated } from "@repo/shared/errors";
import { z } from "zod";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** The `JsonValue` arm that carries field names. */
export type JsonObject = { readonly [key: string]: JsonValue };

/** The two arms of `JsonValue` the walk recurses into, and the only values `ancestors` ever holds. */
type JsonContainer = JsonValue[] | JsonObject;

// Hoisted so the recursive walk reuses one schema per kind instead of rebuilding
// them at every node.
const stringSchema = z.string();
const booleanSchema = z.boolean();
const numberSchema = z.number();
const nanSchema = z.nan();
const bigintSchema = z.bigint();
const symbolSchema = z.symbol();
const functionSchema = z.function();

/** Shared with every other walk over `JsonValue` in this package. */
export function isString(value: unknown): value is string {
  return stringSchema.safeParse(value).success;
}

function isBoolean(value: unknown): value is boolean {
  return booleanSchema.safeParse(value).success;
}

/**
 * Every number, including the ones JSON cannot carry.
 *
 * `z.number()` rejects `NaN` and both infinities, so this guard matches them
 * separately. Otherwise a non-finite number would fall past this guard. The
 * walk would then report it as some other kind entirely, not as a non-finite
 * number.
 */
function isNumber(value: unknown): value is number {
  return (
    numberSchema.safeParse(value).success ||
    nanSchema.safeParse(value).success ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY
  );
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return functionSchema.safeParse(value).success;
}

/**
 * Everything that is neither a primitive nor callable.
 *
 * `typeof` reports "object" for arrays and null alongside objects, so only null
 * needs excluding. Functions report "function" and fall out on their own, which
 * is what lets `visit` name one rather than walk it as a record.
 */
function isJsonContainer(value: unknown): value is JsonContainer {
  // oxlint-disable-next-line rayhanadev/no-typeof -- this walk is the boundary where the rule asks callers to parse input. It must admit every typeof-object so `visitRecord` can name a Date or a class instance in its error rather than let it fall through
  return typeof value === "object" && value !== null;
}

/**
 * The kind name a rejected value carries into the boundary error.
 *
 * Only reached once `visit` rules out null, string, boolean, number,
 * undefined and every container, which leaves exactly bigint, symbol and
 * function.
 */
function rejectedKind(value: unknown): string {
  if (bigintSchema.safeParse(value).success) return "bigint";
  if (symbolSchema.safeParse(value).success) return "symbol";
  return "function";
}

function fail(path: string, detail: string): never {
  throw new InvariantViolated({
    invariant: "Eve JSON serialization boundary",
    detail: `${path}: ${detail}`,
  });
}

function constructorName(value: { readonly [key: string]: JsonValue }): string {
  const constructor = Object.getPrototypeOf(value)?.constructor;
  return isFunction(constructor) && constructor.name !== "" ? constructor.name : "class instance";
}

function isResult(value: JsonContainer): boolean {
  if (!("status" in value) || !("isOk" in value) || !("isErr" in value)) return false;
  return (
    (value.status === "ok" || value.status === "error") &&
    isFunction(value.isOk) &&
    isFunction(value.isErr)
  );
}

function visitArray(value: unknown[], path: string, ancestors: Set<JsonContainer>): JsonValue[] {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(path, "symbol properties are silently omitted by JSON.stringify");
  }
  for (const propertyName of Object.getOwnPropertyNames(value)) {
    if (propertyName === "length") continue;
    const index = Number(propertyName);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      String(index) !== propertyName ||
      index >= value.length
    ) {
      fail(
        `${path}.${propertyName}`,
        "extra array properties are silently omitted by JSON.stringify",
      );
    }
  }

  const output: JsonValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail(`${path}[${index}]`, "sparse array holes become null during JSON serialization");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable) {
      fail(`${path}[${index}]`, "array elements must be enumerable data properties");
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(`${path}[${index}]`, "accessor properties are not data-only JSON");
    }
    output.push(visit(descriptor.value, `${path}[${index}]`, ancestors));
  }
  return output;
}

function visitRecord(
  value: { readonly [key: string]: JsonValue },
  path: string,
  ancestors: Set<JsonContainer>,
): JsonValue {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(path, `${constructorName(value)} instances are not plain JSON objects`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(path, "symbol properties are silently omitted by JSON.stringify");
  }

  const output: Record<string, JsonValue> = {};
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) fail(`${path}.${key}`, "property descriptor disappeared");
    if (!descriptor.enumerable) {
      fail(`${path}.${key}`, "non-enumerable properties are silently omitted by JSON.stringify");
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      fail(`${path}.${key}`, "accessor properties are not data-only JSON");
    }
    Object.defineProperty(output, key, {
      value: visit(descriptor.value, `${path}.${key}`, ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return output;
}

function visit(value: unknown, path: string, ancestors: Set<JsonContainer>): JsonValue {
  if (value === null || isString(value) || isBoolean(value)) return value;
  if (isNumber(value)) {
    if (!Number.isFinite(value)) fail(path, "non-finite numbers are not JSON values");
    if (Object.is(value, -0)) fail(path, "negative zero does not survive a JSON round trip");
    return value;
  }
  if (value === undefined) fail(path, "undefined is silently omitted by JSON.stringify");
  if (!isJsonContainer(value)) fail(path, `${rejectedKind(value)} is not a JSON value`);
  if (isResult(value)) {
    fail(path, "Result must be unwrapped before crossing a JSON boundary");
  }
  if (ancestors.has(value)) fail(path, "cyclic references are not JSON values");

  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? visitArray(value, path, ancestors)
      : visitRecord(value, path, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

/** Assert, without coercion, that a value survives Eve's JSON boundary faithfully. */
function assertJsonValue(value: unknown, boundary: string): JsonValue {
  return visit(value, boundary, new Set());
}

/** Runtime guard used by every authored Eve `defineTool` execute function. */
export function assertToolOutput(value: unknown): JsonValue {
  return assertJsonValue(value, "tool output");
}

/** Keep the inline Eve execute function while guarding every nested return path once. */
export async function guardToolExecution(run: () => unknown): Promise<JsonValue> {
  return assertToolOutput(await run());
}

/** Runtime guard used directly by every authored Eve `defineState` initializer. */
export function assertStateValue<const T extends JsonValue>(value: T): T {
  assertJsonValue(value, "state initial value");
  return value;
}
