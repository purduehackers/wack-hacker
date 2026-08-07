import { assertToolOutput } from "../core/serialization.ts";
import { env } from "../env.ts";

const SENSITIVE_KEY =
  /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|dsn)/i;
const VALUE_SECRET_TOOLS = new Set([
  "create_or_update_repo_secret",
  "create_or_update_org_secret",
  "get_project_env_var",
  "create_project_env_vars",
  "edit_project_env_var",
  "create_edge_config_token",
  "create_sdk_key",
]);

export function redactProviderText(value: string): string {
  let redacted = value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [REDACTED]");
  for (const secret of [env.GITHUB_APP_PRIVATE_KEY, env.SENTRY_AUTH_TOKEN, env.VERCEL_API_TOKEN]) {
    if (secret && secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

export function redactProviderSecrets(
  value: unknown,
  toolName?: string,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactProviderText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redactProviderSecrets(item, toolName, seen));
  }
  const output: Record<string, unknown> = {};
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

export function projectProviderOutput(output: unknown, toolName: string): unknown {
  return assertToolOutput(redactProviderSecrets(assertToolOutput(output), toolName));
}
