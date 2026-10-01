import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['config', 'contracts', 'simulation'].map(name => [`@third-space/${name}`, fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url))])) },
  test: { include: ['packages/simulation/test/race-upgrade.test.ts', 'packages/simulation/test/simulation.test.ts', 'packages/config/test/maps.test.ts', 'apps/web/lib/race-audio.test.ts', 'apps/web/lib/audio.test.ts', 'tests/unit/race-authority.test.ts'] },
});
