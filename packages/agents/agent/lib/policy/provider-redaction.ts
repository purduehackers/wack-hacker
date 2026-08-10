import { z } from "zod";

import { env } from "../../env.ts";
import { assertToolOutput, type JsonValue } from "../core/serialization.ts";

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|dsn)/i;
const VALUE_SECRET_TOOLS = new Set([
  "create_or_update_repo_secret",
  "create_or_update_org_secret",
  "get_project_env_var",
  "create_project_env_vars",
  "edit_project_env_var",
  "create_global_config_token",
  "create_sdk_key",
]);

/**
 * Every value the walk can meet, spelled out. Redaction rewrites strings,
 * rebuilds arrays and objects, and hands every other kind straight back, so the
 * accumulator below carries exactly this union rather than an erased `unknown`.
 */
type ProviderValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | bigint
  | symbol
  | ((...args: never[]) => unknown)
  | ProviderValue[]
  | { [key: string]: ProviderValue };

/** The two arms the walk descends into, and the only values `seen` ever holds. */
type ProviderContainer = ProviderValue[] | { [key: string]: ProviderValue };

// Hoisted so the recursive walk reuses one schema per kind instead of rebuilding
// them at every node.
const stringSchema = z.string();
const objectSchema = z.object({});

function isString(value: unknown): value is string {
  return stringSchema.safeParse(value).success;
}

/**
 * Arrays and non-null objects, the two kinds this walk descends into.
 *
 * `z.object({})` accepts exactly `typeof value === "object" && value !== null &&
 * !Array.isArray(value)`, so pairing it with `Array.isArray` reproduces the
 * whole `typeof value === "object" && value !== null` set — `null`, functions
 * and every other primitive stay outside it and are returned untouched.
 */
function isContainer(value: unknown): value is ProviderContainer {
  return Array.isArray(value) || objectSchema.safeParse(value).success;
}

export function redactProviderText(value: string): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]");
  for (const secret of [env.GITHUB_APP_PRIVATE_KEY, env.SENTRY_AUTH_TOKEN, env.VERCEL_API_TOKEN]) {
    if (secret && secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function redactProviderSecrets(
  value: ProviderValue,
  toolName?: string,
  seen?: WeakSet<ProviderContainer>,
): ProviderValue;
export function redactProviderSecrets(
  value: unknown,
  toolName?: string,
  seen?: WeakSet<ProviderContainer>,
): unknown;
export function redactProviderSecrets(
  value: unknown,
  toolName?: string,
  seen = new WeakSet<ProviderContainer>(),
): unknown {
  if (isString(value)) return redactProviderText(value);
  if (!isContainer(value)) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactProviderSecrets(item, toolName, seen));
  }
  const output: { [key: string]: ProviderValue } = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      SENSITIVE_KEY.test(key) ||
      (VALUE_SECRET_TOOLS.has(toolName ?? "") && /^(?:value|key)$/i.test(key))
    ) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactProviderSecrets(entry, toolName, seen);
    }
  }
  return output;
}

export function projectProviderOutput(output: unknown, toolName: string): JsonValue {
  return assertToolOutput(redactProviderSecrets(assertToolOutput(output), toolName));
}
