import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests: src/**/*.test.ts (no network). Database integration tests: src/**/*.int.test.ts, run with `npm run test:int`.
const integration = process.env.VITEST_INT === "1";

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: integration ? [] : ["src/**/*.int.test.ts", "node_modules/**"],
    // `server-only` throws outside a React Server Component bundle; stub it for tests.
    alias: { "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url).pathname },
  },
});
