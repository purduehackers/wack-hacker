import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "shared",
    include: ["src/**/*.test.ts"],
    // Integration tests are opt-in and run separately, so a plain `vitest run`
    // never needs network or a live Turso/Redis.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
