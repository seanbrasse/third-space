import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "apps/web/lib/**/*.test.ts",
      "tests/unit/**/*.test.ts",
    ],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
