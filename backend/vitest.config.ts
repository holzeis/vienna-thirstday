import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test/testDb.ts"],
    globalSetup: ["./src/test/globalSetup.ts"],
    // Route tests share one real test database via TRUNCATE-between-tests
    // isolation (see test/helpers.ts) - running test files in parallel
    // workers would let them stomp on each other.
    fileParallelism: false,
    // `npm run build`'s tsc output lands in dist/ alongside compiled *.test.js
    // copies of every test file - without this, vitest's default include
    // glob picks those up too and they fail (compiled to CommonJS, which
    // can't `require("vitest")`).
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
