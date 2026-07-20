import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
  test: {
    environment: "node",
    include: ["tests/server/**/*.test.ts"],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      enabled: true,
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      include: ["app/api/**/*.ts", "lib/server/**/*.ts"],
      exclude: ["**/*.d.ts"],
      thresholds: {
        lines: 95,
        statements: 95,
        branches: 90,
        functions: 100,
      },
    },
  },
});
