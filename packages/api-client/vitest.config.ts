import { createCoverageConfig } from "@unimatrix/config-vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: createCoverageConfig({
      thresholds: { statements: 90, functions: 95 },
    }),
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
