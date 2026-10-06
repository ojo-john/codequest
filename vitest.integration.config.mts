import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests against the LOCAL Supabase stack (`npx supabase start`). They share one
// database, so files run one at a time.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
