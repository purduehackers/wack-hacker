import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    env: {
      SKIP_ENV_VALIDATION: "1",
    },
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "src/app/**",
        "src/env.ts",
        "src/server/**",
        "src/workflows/**",
        "src/bot/handlers/**",
        "src/bot/integrations/**",
        "src/lib/ascii.ts",
        "src/lib/test/**",
        "src/lib/protocol/utils.ts",
        "src/**/*.test.ts",
        "src/**/errors.ts",
        "src/**/types.ts",
        "src/**/enums.ts",
        "src/**/constants.ts",
        "src/lib/ai/skills/generated/**",
        "src/lib/ai/tools/**",
        "src/lib/evlog.ts",
        "src/lib/db/**",
        // Thin wrappers around @vercel/sandbox / factory wiring. Covered by
        // hooks.ts + integration tests — unit coverage here would be 90%
        // SDK-glue assertions against mocks.
        "src/lib/sandbox/vercel-sandbox.ts",
        "src/lib/sandbox/factory.ts",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
