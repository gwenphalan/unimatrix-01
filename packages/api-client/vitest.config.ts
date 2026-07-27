import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: createCoverageConfig({
      thresholds: { statements: 89, functions: 100 },
    }),
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
