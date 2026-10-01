import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: Object.fromEntries(["config","contracts","simulation","data"].map(name=>[`@third-space/${name}`,fileURLToPath(new URL(`./packages/${name}/src/index.ts`,import.meta.url))])) },
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
