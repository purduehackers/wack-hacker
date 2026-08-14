/**
 * @fileoverview Scrubs provider tool output before the model reads it. A
 * key-name pattern catches the usual secret spellings, and a per-tool list
 * catches endpoints whose payloads carry the secret under `value` or `key`.
 * Free text loses bearer tokens and known environment credentials as well.
 */

import { z } from "zod";

import { env } from "../../env.ts";
import { assertToolOutput, isString, type JsonValue } from "../serialization.ts";

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
 * rebuilds arrays and objects, and hands every other kind straight back. The
 * accumulator below therefore carries exactly this union rather than an erased
 * `unknown`.
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

// Hoisted so the recursive walk reuses one schema instead of rebuilding it at
// every node.
const objectSchema = z.object({});

/**
 * Arrays and non-null objects, the two kinds this walk descends into.
 *
 * `z.object({})` accepts exactly `typeof value === "object" && value !== null &&
 * !Array.isArray(value)`, so pairing it with `Array.isArray` reproduces the
 * whole `typeof value === "object" && value !== null` set. `null`, functions
 * and every other primitive stay outside it and come back untouched.
 */
function isContainer(value: unknown): value is ProviderContainer {
  return Array.isArray(value) || objectSchema.safeParse(value).success;
}

/**
 * Strips bearer tokens and known environment credentials from free text. A
 * secret shorter than four characters never becomes a filter, because a match
 * that short would strike ordinary prose everywhere.
 */
export function redactProviderText(value: string): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]");
  for (const secret of [
    env.GITHUB_APP_PRIVATE_KEY,
    env.SENTRY_AUTH_TOKEN,
    env.SENTRY_API_TOKEN,
    env.VERCEL_API_TOKEN,
  ]) {
    if (secret && secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

/**
 * Walks a payload and blanks every value under a secret-looking key. For the
 * tools in `VALUE_SECRET_TOOLS`, the generic `value` and `key` fields hold the
 * secret itself, so those blank too regardless of name. Strings pass through
 * `redactProviderText`, and a cycle collapses to `"[Circular]"`.
 */
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

/**
 * The policy boundary for provider tool output. It asserts JSON shape both
 * before and after redaction, so a redactor bug surfaces here and not in the
 * model's context.
 */
export function projectProviderOutput(output: unknown, toolName: string): JsonValue {
  return assertToolOutput(redactProviderSecrets(assertToolOutput(output), toolName));
}
