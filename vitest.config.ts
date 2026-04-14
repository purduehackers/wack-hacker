import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/env.ts",
        "src/server/**",
        "src/lib/ascii.ts",
        "src/lib/test/**",
        "src/lib/bot/handlers/**",
        "src/lib/discord/utils.ts",
        "src/**/*.test.ts",
        "src/**/errors.ts",
        "src/**/types.ts",
        "src/**/enums.ts",
        "src/**/constants.ts",
        "src/lib/services/**",
        "src/handlers/**",
        "src/lib/bot/integrations/**",
        "src/lib/ai/skills/generated/**",
        "src/lib/ai/tools/discord/**",
        "src/lib/ai/tools/github/**",
        "src/lib/ai/tools/linear/**",
        "src/lib/ai/tools/notion/**",
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
