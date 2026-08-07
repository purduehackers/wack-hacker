import { describe, expect, test } from "bun:test";

import {
  projectProviderOutput,
  redactProviderSecrets,
  redactProviderText,
} from "./provider-redaction.ts";

describe("provider secret projection", () => {
  test("redacts bearer text, sensitive keys, and secret-value tools", () => {
    expect(redactProviderText("failed with Bearer abc.def-123")).toBe(
      "failed with Bearer [REDACTED]",
    );
    expect(
      redactProviderSecrets({ authorization: "Bearer token", nested: { api_key: "secret" } }),
    ).toEqual({ authorization: "[REDACTED]", nested: { api_key: "[REDACTED]" } });
    expect(
      redactProviderSecrets(
        { name: "TOKEN", value: "provider-secret" },
        "create_or_update_repo_secret",
      ),
    ).toEqual({ name: "TOKEN", value: "[REDACTED]" });
  });

  test("projects only plain JSON and protects circular values", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(redactProviderSecrets({ circular })).toEqual({
      circular: { self: "[Circular]" },
    });
    expect(() => projectProviderOutput({ circular }, "get_project_env_var")).toThrow(
      "cyclic references are not JSON values",
    );
  });
});
