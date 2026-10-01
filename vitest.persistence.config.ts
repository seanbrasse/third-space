import { defineConfig } from 'vitest/config';
export default defineConfig({resolve:{alias:{'@third-space/config':new URL('./packages/config/src/index.ts',import.meta.url).pathname,'@third-space/contracts':new URL('./packages/contracts/src/index.ts',import.meta.url).pathname}},test:{include:['apps/web/lib/local-persistence.test.ts']}});
