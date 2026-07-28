import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: createCoverageConfig({
      thresholds: { statements: 26, functions: 23 },
    }),
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
