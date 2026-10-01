import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Use the isolated snapshot's workspace sources despite shared dependency links.
export default defineConfig({
  cacheDir: ".flashlight-cache",
  resolve: {
    alias: Object.fromEntries(
      ["config", "contracts", "simulation", "data"].map((name) => [
        `@third-space/${name}`,
        fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
      ]),
    ),
  },
  test: { include: ["tests/unit/flashlight.test.ts", "tests/unit/party-room.test.ts"], testTimeout: 15000 },
});
