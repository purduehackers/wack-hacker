import { InvariantViolated } from "@repo/shared/errors";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

function fail(path: string, detail: string): never {
  throw new InvariantViolated({
    invariant: "Eve JSON serialization boundary",
    detail: `${path}: ${detail}`,
  });
}

function constructorName(value: object): string {
  const constructor = Object.getPrototypeOf(value)?.constructor;
  return typeof constructor === "function" && constructor.name !== ""
    ? constructor.name
    : "class instance";
}

function isResult(value: object): boolean {
  if (!("status" in value) || !("isOk" in value) || !("isErr" in value)) return false;
  return (
    (value.status === "ok" || value.status === "error") &&
    typeof value.isOk === "function" &&
    typeof value.isErr === "function"
  );
}

function visitArray(value: unknown[], path: string, ancestors: Set<object>): JsonValue[] {
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

function visitRecord(value: object, path: string, ancestors: Set<object>): JsonValue {
  const prototype = Object.getPrototypeOf(value);
  // oxlint-disable-next-line unicorn/no-null -- Object.create(null) is still a data-only record
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

function visit(value: unknown, path: string, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "non-finite numbers are not JSON values");
    if (Object.is(value, -0)) fail(path, "negative zero does not survive a JSON round trip");
    return value;
  }
  if (value === undefined) fail(path, "undefined is silently omitted by JSON.stringify");
  if (typeof value !== "object") fail(path, `${typeof value} is not a JSON value`);
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
export function assertJsonValue(value: unknown, boundary = "JSON boundary"): JsonValue {
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
