import "dotenv/config";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Database tests share one seeded Postgres; run files one at a time so they never interleave.
    fileParallelism: false,
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
